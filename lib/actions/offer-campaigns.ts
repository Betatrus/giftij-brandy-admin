"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSignedCampaignUpload, getImageResource, isCampaignMediaCloudinaryId } from "@/lib/cloudinary";

async function requireMarketingAccess() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT"].includes(session.user.role)) {
    throw new Error("FORBIDDEN: Marketing campaign management requires elevated access.");
  }
  return session;
}

function clean(value: FormDataEntryValue | null, label: string, max: number) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(label + " is required.");
  if (result.length > max) throw new Error(label + " is too long.");
  return result;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function optionalDate(value: FormDataEntryValue | null, label: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(label + " is invalid.");
  return date;
}


async function resolveCampaignCreative(formData: FormData) {
  const cloudinaryId = String(formData.get("creativeImagePublicId") ?? "").trim();
  if (cloudinaryId) {
    if (!isCampaignMediaCloudinaryId(cloudinaryId)) throw new Error("Invalid campaign image asset.");
    const asset = await getImageResource(cloudinaryId);
    if (!isCampaignMediaCloudinaryId(asset.cloudinaryId) || !asset.url.startsWith("https://")) {
      throw new Error("The uploaded campaign image could not be verified.");
    }
    return { url: asset.url, publicId: asset.cloudinaryId };
  }
  const url = String(formData.get("creativeImageUrl") ?? "").trim();
  if (!url) return { url: null, publicId: null };
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Creative image URL must be a valid absolute URL."); }
  if (parsed.protocol !== "https:") throw new Error("Creative image URL must use HTTPS.");
  return { url, publicId: null };
}

export async function getCampaignCreativeUploadSignature() {
  await requireMarketingAccess();
  return createSignedCampaignUpload();
}

export async function createOfferCampaign(formData: FormData) {
  const session = await requireMarketingAccess();
  const title = clean(formData.get("title"), "Campaign title", 120);
  const announcementHtml = String(formData.get("announcementHtml") ?? "").trim();
  if (announcementHtml.length > 20000) throw new Error("Announcement HTML must be 20,000 characters or fewer.");
  const slug = slugify(String(formData.get("slug") || title));
  if (!slug) throw new Error("A valid campaign URL slug is required.");
  const existing = await prisma.offerCampaign.findUnique({ where: { slug }, select: { id: true } });
  if (existing) throw new Error("That campaign URL is already in use.");
  const startsAt = optionalDate(formData.get("startsAt"), "Start date");
  const endsAt = optionalDate(formData.get("endsAt"), "End date");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("End date must be after the start date.");
  const maxRaw = String(formData.get("maxQualifyingOrders") ?? "").trim();
  const maxQualifyingOrders = maxRaw ? Number(maxRaw) : null;
  if (maxQualifyingOrders !== null && (!Number.isInteger(maxQualifyingOrders) || maxQualifyingOrders < 1)) {
    throw new Error("Order limit must be a positive whole number.");
  }
  const creative = await resolveCampaignCreative(formData);
  const campaign = await prisma.offerCampaign.create({ data: {
    title, slug,
    description: String(formData.get("description") ?? "").trim() || null,
    announcementHtml: announcementHtml || null,
    creativeImageUrl: creative.url,
    creativeImagePublicId: creative.publicId,
    ctaText: String(formData.get("ctaText") ?? "").trim() || "Shop the offer",
    startsAt, endsAt, maxQualifyingOrders,
  }});
  await logActivity({ userId: session.user.id, action: "OFFER_CAMPAIGN_CREATED", resource: `OfferCampaign:${campaign.id}`, metadata: { title, slug } });
  revalidatePath("/admin/marketing");
}

export async function createOfferSet(formData: FormData) {
  const session = await requireMarketingAccess();
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);
  const title = clean(formData.get("title"), "Offer Set title", 100);
  const productIds = Array.from(new Set(formData.getAll("productIds").map(String).filter(Boolean)));
  if (!productIds.length) throw new Error("Select at least one product for this Offer Set.");
  const campaign = await prisma.offerCampaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) throw new Error("Campaign not found.");
  const limitRaw = String(formData.get("maxQualifyingOrders") ?? "").trim();
  const maxQualifyingOrders = limitRaw ? Number(limitRaw) : null;
  if (maxQualifyingOrders !== null && (!Number.isInteger(maxQualifyingOrders) || maxQualifyingOrders < 1)) {
    throw new Error("Offer Set order limit must be a positive whole number.");
  }
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true, price: true } });
  if (products.length !== productIds.length) throw new Error("One or more selected products are unavailable. Refresh and select active products only.");
  const discountRaw = String(formData.get("discountPercent") ?? "").trim();
  const amountRaw = String(formData.get("discountAmount") ?? "").trim();
  const discountPercent = discountRaw ? Number(discountRaw) : null;
  const discountAmount = amountRaw ? Number(amountRaw) : null;
  if (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100)) throw new Error("Discount must be greater than 0 and below 100 percent.");
  if (discountPercent !== null && discountAmount !== null) throw new Error("Choose either a percentage or fixed discount, not both.");
  if (discountAmount !== null && (!Number.isFinite(discountAmount) || discountAmount <= 0 || products.some((product) => discountAmount >= Number(product.price)))) {
    throw new Error("Fixed discount must be greater than zero and below the selling price of every selected product.");
  }
  const freeDelivery = formData.get("freeDelivery") === "on";
  const giftDescription = String(formData.get("giftDescription") ?? "").trim() || null;
  if (discountPercent === null && discountAmount === null && !freeDelivery && !giftDescription) throw new Error("Add at least one benefit: percentage discount, fixed discount, free delivery, or gift.");
  const maxSort = await prisma.offerSet.aggregate({ where: { campaignId }, _max: { sortOrder: true } });
  const offerSet = await prisma.offerSet.create({ data: {
    campaignId, title, description: String(formData.get("description") ?? "").trim() || null,
    maxQualifyingOrders,
    sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    products: { create: productIds.map((productId) => ({ productId, discountPercent, discountAmount, freeDelivery, giftDescription })) },
  }});
  await logActivity({ userId: session.user.id, action: "OFFER_SET_CREATED", resource: `OfferSet:${offerSet.id}`, metadata: { campaignId, title, productCount: productIds.length } });
  revalidatePath("/admin/marketing");
}

function showMarketingNotice(message: string): never {
  redirect(`/admin/marketing?view=manage&notice=${encodeURIComponent(message)}#campaign-workspace`);
}

export async function activateOfferSet(formData: FormData) {
  const session = await requireMarketingAccess();
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);
  const offerSetId = clean(formData.get("offerSetId"), "Offer Set", 80);
  const offerSet = await prisma.offerSet.findFirst({
    where: { id: offerSetId, campaignId, isEnabled: true },
    select: { id: true, maxQualifyingOrders: true, qualifyingOrdersCount: true, reservedQualifyingOrders: true },
  });
  if (!offerSet) showMarketingNotice("That Offer Set is turned off. Turn it on before making it the customer-facing set.");
  if (offerSet.maxQualifyingOrders !== null &&
    offerSet.qualifyingOrdersCount + offerSet.reservedQualifyingOrders >= offerSet.maxQualifyingOrders) {
    throw new Error("That Offer Set has reached its order limit. Enable or select another Offer Set.");
  }
  await prisma.offerCampaign.update({ where: { id: campaignId }, data: { activeOfferSetId: offerSetId } });
  await logActivity({ userId: session.user.id, action: "OFFER_SET_ACTIVATED", resource: `OfferCampaign:${campaignId}`, metadata: { offerSetId } });
  revalidatePath("/admin/marketing");
}

export async function updateOfferCampaignStatus(formData: FormData) {
  const session = await requireMarketingAccess();
  const id = clean(formData.get("campaignId"), "Campaign", 80);
  const status = String(formData.get("status") ?? "");
  if (!["DRAFT", "PUBLISHED", "PAUSED", "ENDED"].includes(status)) throw new Error("Invalid campaign status.");
  const campaign = await prisma.offerCampaign.findUnique({ where: { id }, include: { offerSets: { where: { isEnabled: true }, select: { id: true, maxQualifyingOrders: true, qualifyingOrdersCount: true, reservedQualifyingOrders: true } } } });
  if (!campaign) throw new Error("Campaign not found.");
  if (status === "PUBLISHED" && campaign.offerSets.length === 0) {
    showMarketingNotice("This campaign needs at least one enabled Offer Set before it can be published. Turn on an Offer Set, then try again.");
  }
  await prisma.offerCampaign.update({ where: { id }, data: { status: status as "DRAFT" | "PUBLISHED" | "PAUSED" | "ENDED" } });
  await logActivity({ userId: session.user.id, action: "OFFER_CAMPAIGN_STATUS_UPDATED", resource: `OfferCampaign:${id}`, metadata: { status } });
  revalidatePath("/admin/marketing");
}

export async function updateOfferCampaign(formData: FormData) {
  const session = await requireMarketingAccess();
  const id = clean(formData.get("campaignId"), "Campaign", 80);
  const title = clean(formData.get("title"), "Campaign title", 120);
  const announcementHtml = String(formData.get("announcementHtml") ?? "").trim();
  if (announcementHtml.length > 20000) throw new Error("Announcement HTML must be 20,000 characters or fewer.");
  const slug = slugify(String(formData.get("slug") || title));
  if (!slug) throw new Error("A valid campaign URL slug is required.");
  const duplicate = await prisma.offerCampaign.findFirst({ where: { slug, id: { not: id } }, select: { id: true } });
  if (duplicate) throw new Error("That campaign URL is already in use.");
  const existingCampaign = await prisma.offerCampaign.findUnique({
    where: { id },
    select: { qualifyingOrdersCount: true, reservedQualifyingOrders: true },
  });
  if (!existingCampaign) throw new Error("Campaign not found.");
  const startsAt = optionalDate(formData.get("startsAt"), "Start date");
  const endsAt = optionalDate(formData.get("endsAt"), "End date");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("End date must be after the start date.");
  const maxRaw = String(formData.get("maxQualifyingOrders") ?? "").trim();
  const maxQualifyingOrders = maxRaw ? Number(maxRaw) : null;
  if (maxQualifyingOrders !== null && (!Number.isInteger(maxQualifyingOrders) || maxQualifyingOrders < 1)) throw new Error("Order limit must be a positive whole number.");
  if (maxQualifyingOrders !== null && maxQualifyingOrders < existingCampaign.qualifyingOrdersCount + existingCampaign.reservedQualifyingOrders) {
    throw new Error("The campaign limit cannot be lower than paid orders plus active reserved slots.");
  }
  const creative = await resolveCampaignCreative(formData);
  await prisma.offerCampaign.update({ where: { id }, data: {
    title, slug, description: String(formData.get("description") ?? "").trim() || null,
    announcementHtml: announcementHtml || null,
    creativeImageUrl: creative.url,
    creativeImagePublicId: creative.publicId,
    ctaText: String(formData.get("ctaText") ?? "").trim() || "Shop the offer",
    startsAt, endsAt, maxQualifyingOrders,
  }});
  await logActivity({ userId: session.user.id, action: "OFFER_CAMPAIGN_UPDATED", resource: `OfferCampaign:${id}`, metadata: { title, slug } });
  revalidatePath("/admin/marketing");
}

export async function updateOfferSet(formData: FormData) {
  const session = await requireMarketingAccess();
  const id = clean(formData.get("offerSetId"), "Offer Set", 80);
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);
  const title = clean(formData.get("title"), "Offer Set title", 100);
  const productIds = Array.from(new Set(formData.getAll("productIds").map(String).filter(Boolean)));
  if (!productIds.length) throw new Error("Select at least one product for this Offer Set.");
  const existing = await prisma.offerSet.findFirst({
    where: { id, campaignId },
    select: { id: true, qualifyingOrdersCount: true, reservedQualifyingOrders: true },
  });
  if (!existing) throw new Error("Offer Set not found for this campaign.");
  const limitRaw = String(formData.get("maxQualifyingOrders") ?? "").trim();
  const maxQualifyingOrders = limitRaw ? Number(limitRaw) : null;
  if (maxQualifyingOrders !== null && (!Number.isInteger(maxQualifyingOrders) || maxQualifyingOrders < 1)) {
    throw new Error("Offer Set order limit must be a positive whole number.");
  }
  if (maxQualifyingOrders !== null && maxQualifyingOrders < existing.qualifyingOrdersCount + existing.reservedQualifyingOrders) {
    throw new Error("The Offer Set limit cannot be lower than paid orders plus active reserved slots.");
  }
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true, price: true } });
  if (products.length !== productIds.length) throw new Error("One or more selected products are unavailable. Refresh and select active products only.");
  const discountRaw = String(formData.get("discountPercent") ?? "").trim();
  const amountRaw = String(formData.get("discountAmount") ?? "").trim();
  const discountPercent = discountRaw ? Number(discountRaw) : null;
  const discountAmount = amountRaw ? Number(amountRaw) : null;
  if (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100)) throw new Error("Discount must be greater than 0 and below 100 percent.");
  if (discountPercent !== null && discountAmount !== null) throw new Error("Choose either a percentage or fixed discount, not both.");
  if (discountAmount !== null && (!Number.isFinite(discountAmount) || discountAmount <= 0 || products.some((product) => discountAmount >= Number(product.price)))) {
    throw new Error("Fixed discount must be greater than zero and below the selling price of every selected product.");
  }
  const freeDelivery = formData.get("freeDelivery") === "on";
  const giftDescription = String(formData.get("giftDescription") ?? "").trim() || null;
  if (discountPercent === null && discountAmount === null && !freeDelivery && !giftDescription) throw new Error("Add at least one benefit: percentage discount, fixed discount, free delivery, or gift.");
  await prisma.$transaction(async (tx) => {
    await tx.offerSet.update({ where: { id }, data: { title, description: String(formData.get("description") ?? "").trim() || null, maxQualifyingOrders } });
    await tx.offerSetProduct.deleteMany({ where: { offerSetId: id } });
    await tx.offerSetProduct.createMany({ data: productIds.map((productId) => ({ offerSetId: id, productId, discountPercent, discountAmount, freeDelivery, giftDescription })) });
  });
  await logActivity({ userId: session.user.id, action: "OFFER_SET_UPDATED", resource: `OfferSet:${id}`, metadata: { campaignId, title, productCount: productIds.length } });
  revalidatePath("/admin/marketing");
}


export async function toggleOfferSetEnabled(formData: FormData) {
  const session = await requireMarketingAccess();
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);
  const offerSetId = clean(formData.get("offerSetId"), "Offer Set", 80);
  const enabled = String(formData.get("enabled") ?? "") === "true";

  let blockedMessage: string | null = null;
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.offerCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, activeOfferSetId: true },
    });
    if (!campaign) throw new Error("Campaign not found.");
    const offerSet = await tx.offerSet.findFirst({
      where: { id: offerSetId, campaignId },
      select: { id: true },
    });
    if (!offerSet) throw new Error("Offer Set not found for this campaign.");

    if (!enabled && campaign.status === "PUBLISHED") {
      const enabledCount = await tx.offerSet.count({ where: { campaignId, isEnabled: true } });
      if (enabledCount <= 1) {
        blockedMessage = "This campaign needs at least one enabled Offer Set while it is published. Pause the campaign first if you want to turn off every Offer Set.";
        return;
      }
    }

    await tx.offerSet.update({ where: { id: offerSetId }, data: { isEnabled: enabled } });
    if (!enabled && campaign.activeOfferSetId === offerSetId) {
      const replacement = await tx.offerSet.findFirst({
        where: { campaignId, isEnabled: true, id: { not: offerSetId } },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      await tx.offerCampaign.update({
        where: { id: campaignId },
        data: {
          activeOfferSetId: replacement?.id ?? null,
        },
      });
    }
  });
  if (blockedMessage) showMarketingNotice(blockedMessage);

  await logActivity({
    userId: session.user.id,
    action: enabled ? "OFFER_SET_ENABLED" : "OFFER_SET_DISABLED",
    resource: `OfferSet:${offerSetId}`,
    metadata: { campaignId, enabled },
  });
  revalidatePath("/admin/marketing");
  revalidatePath("/offers");
}

export async function deleteOfferCampaign(formData: FormData) {
  const session = await requireMarketingAccess();
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);

  const campaign = await prisma.offerCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      title: true,
      slug: true,
      qualifyingOrdersCount: true,
      reservedQualifyingOrders: true,
      offerSets: { select: { qualifyingOrdersCount: true, reservedQualifyingOrders: true } },
    },
  });
  if (!campaign) throw new Error("Campaign not found.");

  const hasOfferSetHistory = campaign.offerSets.some((set) =>
    set.qualifyingOrdersCount > 0 || set.reservedQualifyingOrders > 0
  );
  const activeReservations = await prisma.checkoutReservation.count({
    where: {
      offerCampaignId: campaignId,
      status: "ACTIVE",
    },
  });
  if (
    campaign.qualifyingOrdersCount > 0 ||
    campaign.reservedQualifyingOrders > 0 ||
    hasOfferSetHistory ||
    activeReservations > 0
  ) {
    throw new Error(
      "This campaign has paid orders or active checkout reservations. End or pause it instead of deleting it so its order history and payment records remain protected.",
    );
  }

  await prisma.offerCampaign.delete({ where: { id: campaignId } });
  await logActivity({
    userId: session.user.id,
    action: "OFFER_CAMPAIGN_DELETED",
    resource: `OfferCampaign:${campaignId}`,
    metadata: { title: campaign.title, slug: campaign.slug },
  });
  revalidatePath("/admin/marketing");
  revalidatePath(`/offers/${campaign.slug}`);
}
