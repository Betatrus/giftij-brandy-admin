"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

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

export async function createOfferCampaign(formData: FormData) {
  const session = await requireMarketingAccess();
  const title = clean(formData.get("title"), "Campaign title", 120);
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
  const campaign = await prisma.offerCampaign.create({ data: {
    title, slug,
    description: String(formData.get("description") ?? "").trim() || null,
    creativeImageUrl: String(formData.get("creativeImageUrl") ?? "").trim() || null,
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
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true } });
  if (products.length !== productIds.length) throw new Error("One or more selected products are unavailable. Refresh and select active products only.");
  const discountRaw = String(formData.get("discountPercent") ?? "").trim();
  const discountPercent = discountRaw ? Number(discountRaw) : null;
  if (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100)) {
    throw new Error("Discount must be greater than 0 and no more than 100 percent.");
  }
  const freeDelivery = formData.get("freeDelivery") === "on";
  const giftDescription = String(formData.get("giftDescription") ?? "").trim() || null;
  if (discountPercent === null && !freeDelivery && !giftDescription) {
    throw new Error("Add at least one benefit: discount, free delivery, or gift.");
  }
  const maxSort = await prisma.offerSet.aggregate({ where: { campaignId }, _max: { sortOrder: true } });
  const offerSet = await prisma.offerSet.create({ data: {
    campaignId, title, description: String(formData.get("description") ?? "").trim() || null,
    sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    products: { create: productIds.map((productId) => ({ productId, discountPercent, freeDelivery, giftDescription })) },
  }});
  await logActivity({ userId: session.user.id, action: "OFFER_SET_CREATED", resource: `OfferSet:${offerSet.id}`, metadata: { campaignId, title, productCount: productIds.length } });
  revalidatePath("/admin/marketing");
}

export async function activateOfferSet(formData: FormData) {
  const session = await requireMarketingAccess();
  const campaignId = clean(formData.get("campaignId"), "Campaign", 80);
  const offerSetId = clean(formData.get("offerSetId"), "Offer Set", 80);
  const offerSet = await prisma.offerSet.findFirst({ where: { id: offerSetId, campaignId, isEnabled: true }, select: { id: true } });
  if (!offerSet) throw new Error("That Offer Set is not enabled for this campaign.");
  await prisma.offerCampaign.update({ where: { id: campaignId }, data: { activeOfferSetId: offerSetId } });
  await logActivity({ userId: session.user.id, action: "OFFER_SET_ACTIVATED", resource: `OfferCampaign:${campaignId}`, metadata: { offerSetId } });
  revalidatePath("/admin/marketing");
}

export async function updateOfferCampaignStatus(formData: FormData) {
  const session = await requireMarketingAccess();
  const id = clean(formData.get("campaignId"), "Campaign", 80);
  const status = String(formData.get("status") ?? "");
  if (!["DRAFT", "PUBLISHED", "PAUSED", "ENDED"].includes(status)) throw new Error("Invalid campaign status.");
  const campaign = await prisma.offerCampaign.findUnique({ where: { id }, include: { offerSets: { where: { isEnabled: true }, select: { id: true } } } });
  if (!campaign) throw new Error("Campaign not found.");
  if (status === "PUBLISHED") throw new Error("Publishing is not enabled yet. The public campaign page, checkout price validation, and qualifying-order reservation flow must be integrated and tested first.");
  if (status === "PUBLISHED" && !campaign.activeOfferSetId) throw new Error("Choose the Offer Set customers should see before publishing.");
  await prisma.offerCampaign.update({ where: { id }, data: { status: status as "DRAFT" | "PUBLISHED" | "PAUSED" | "ENDED" } });
  await logActivity({ userId: session.user.id, action: "OFFER_CAMPAIGN_STATUS_UPDATED", resource: `OfferCampaign:${id}`, metadata: { status } });
  revalidatePath("/admin/marketing");
}

export async function updateOfferCampaign(formData: FormData) {
  const session = await requireMarketingAccess();
  const id = clean(formData.get("campaignId"), "Campaign", 80);
  const title = clean(formData.get("title"), "Campaign title", 120);
  const slug = slugify(String(formData.get("slug") || title));
  if (!slug) throw new Error("A valid campaign URL slug is required.");
  const duplicate = await prisma.offerCampaign.findFirst({ where: { slug, id: { not: id } }, select: { id: true } });
  if (duplicate) throw new Error("That campaign URL is already in use.");
  const startsAt = optionalDate(formData.get("startsAt"), "Start date");
  const endsAt = optionalDate(formData.get("endsAt"), "End date");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("End date must be after the start date.");
  const maxRaw = String(formData.get("maxQualifyingOrders") ?? "").trim();
  const maxQualifyingOrders = maxRaw ? Number(maxRaw) : null;
  if (maxQualifyingOrders !== null && (!Number.isInteger(maxQualifyingOrders) || maxQualifyingOrders < 1)) throw new Error("Order limit must be a positive whole number.");
  await prisma.offerCampaign.update({ where: { id }, data: {
    title, slug, description: String(formData.get("description") ?? "").trim() || null,
    creativeImageUrl: String(formData.get("creativeImageUrl") ?? "").trim() || null,
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
  const existing = await prisma.offerSet.findFirst({ where: { id, campaignId }, select: { id: true } });
  if (!existing) throw new Error("Offer Set not found for this campaign.");
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true } });
  if (products.length !== productIds.length) throw new Error("One or more selected products are unavailable. Refresh and select active products only.");
  const discountRaw = String(formData.get("discountPercent") ?? "").trim();
  const discountPercent = discountRaw ? Number(discountRaw) : null;
  if (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100)) throw new Error("Discount must be greater than 0 and no more than 100 percent.");
  const freeDelivery = formData.get("freeDelivery") === "on";
  const giftDescription = String(formData.get("giftDescription") ?? "").trim() || null;
  if (discountPercent === null && !freeDelivery && !giftDescription) throw new Error("Add at least one benefit: discount, free delivery, or gift.");
  await prisma.$transaction(async (tx) => {
    await tx.offerSet.update({ where: { id }, data: { title, description: String(formData.get("description") ?? "").trim() || null } });
    await tx.offerSetProduct.deleteMany({ where: { offerSetId: id } });
    await tx.offerSetProduct.createMany({ data: productIds.map((productId) => ({ offerSetId: id, productId, discountPercent, freeDelivery, giftDescription })) });
  });
  await logActivity({ userId: session.user.id, action: "OFFER_SET_UPDATED", resource: `OfferSet:${id}`, metadata: { campaignId, title, productCount: productIds.length } });
  revalidatePath("/admin/marketing");
}
