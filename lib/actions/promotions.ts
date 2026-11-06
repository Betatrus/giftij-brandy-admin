"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath, revalidateTag } from "next/cache";

type OfferSetInput = {
  id?: string;
  name: string;
  description?: string;
  productIds: string[];
  benefits: string[];
  discountType?: "PERCENTAGE" | "FIXED";
  discountValue?: number;
  giftDescription?: string;
  closingMode: "DURATION" | "ORDER_LIMIT";
  endsAt?: string;
  orderLimit?: number;
  isEnabled: boolean;
};

type CampaignInput = {
  id?: string;
  name: string;
  slug: string;
  announcementMode: "HTML" | "FLYER";
  imageUrl?: string;
  headline: string;
  caption?: string;
  message?: string;
  ctaLabel: string;
  popupEnabled: boolean;
  bannerEnabled: boolean;
  popupSeconds: number;
  startsAt?: string;
  endsAt?: string;
  status: "DRAFT" | "SCHEDULED" | "LIVE" | "PAUSED";
  offerSets: OfferSetInput[];
};

async function requireMarketingAccess() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"].includes(session.user.role)) {
    throw new Error("FORBIDDEN: you do not have permission to manage offers");
  }
  return session;
}

function cleanText(value: string | undefined, label: string, max: number, required = false) {
  const clean = value?.trim() ?? "";
  if (required && !clean) throw new Error(label + " is required.");
  if (clean.length > max) throw new Error(label + " is too long.");
  return clean || null;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function listPromotionCampaigns() {
  await requireMarketingAccess();
  return prisma.promotionCampaign.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { offerSets: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getPromotionBuilderData() {
  await requireMarketingAccess();
  const [campaigns, products] = await Promise.all([
    prisma.promotionCampaign.findMany({
      orderBy: { updatedAt: "desc" },
      include: { offerSets: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, slug: true, price: true, discount: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      offerSets: campaign.offerSets.map((set) => ({
        ...set,
        discountValue: set.discountValue == null ? null : Number(set.discountValue),
      })),
    })),
    products: products.map((product) => ({
      ...product,
      price: Number(product.price),
      discount: Number(product.discount ?? 0),
    })),
  };
}

export async function savePromotionCampaign(input: CampaignInput) {
  const session = await requireMarketingAccess();
  const name = cleanText(input.name, "Campaign name", 100, true)!;
  const headline = cleanText(input.headline, "Announcement headline", 140, true)!;
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("Enter a valid campaign URL.");
  if (!Array.isArray(input.offerSets) || input.offerSets.length === 0) {
    throw new Error("Add at least one offer set.");
  }
  if (!Number.isInteger(input.popupSeconds) || input.popupSeconds < 2 || input.popupSeconds > 20) {
    throw new Error("Popup display time must be between 2 and 20 seconds.");
  }
  if (input.announcementMode === "FLYER" && !input.imageUrl?.trim()) {
    throw new Error("Upload an announcement image or choose the HTML announcement design.");
  }
  const existingSlug = await prisma.promotionCampaign.findUnique({ where: { slug }, select: { id: true } });
  if (existingSlug && existingSlug.id !== input.id) throw new Error("That campaign URL is already in use.");

  const allProductIds = Array.from(new Set(input.offerSets.flatMap((set) => set.productIds)));
  if (allProductIds.length === 0) throw new Error("Select products for your offer sets.");
  const foundProducts = await prisma.product.count({ where: { id: { in: allProductIds }, status: "ACTIVE" } });
  if (foundProducts !== allProductIds.length) throw new Error("One or more selected products are no longer active. Refresh and select products again.");

  const offerSets = input.offerSets.map((set, index) => {
    const benefits = Array.from(new Set(set.benefits)).filter((benefit) => ["DISCOUNT", "FREE_DELIVERY", "FREE_GIFT"].includes(benefit));
    if (!set.name.trim() || set.name.trim().length > 80) throw new Error("Every offer set needs a name of 1–80 characters.");
    if (set.productIds.length === 0) throw new Error('Select at least one product for "' + set.name + '".');
    if (benefits.length === 0) throw new Error('Choose at least one benefit for "' + set.name + '".');
    if (benefits.includes("DISCOUNT")) {
      if (!set.discountType || !Number.isFinite(set.discountValue) || Number(set.discountValue) <= 0) throw new Error('Enter a valid discount for "' + set.name + '".');
      if (set.discountType === "PERCENTAGE" && Number(set.discountValue) > 100) throw new Error("Percentage discount cannot exceed 100%.");
    }
    if (benefits.includes("FREE_GIFT") && !set.giftDescription?.trim()) throw new Error('Describe the free gift for "' + set.name + '".');
    if (set.closingMode === "DURATION" && !set.endsAt) throw new Error('Set an end date for "' + set.name + '".');
    if (set.closingMode === "ORDER_LIMIT" && (!Number.isInteger(set.orderLimit) || Number(set.orderLimit) < 1)) throw new Error('Enter a valid qualifying-order limit for "' + set.name + '".');
    return {
      id: set.id,
      name: set.name.trim(),
      description: cleanText(set.description, "Offer description", 400),
      productIds: Array.from(new Set(set.productIds)),
      benefits,
      discountType: benefits.includes("DISCOUNT") ? set.discountType : null,
      discountValue: benefits.includes("DISCOUNT") ? Number(set.discountValue) : null,
      giftDescription: benefits.includes("FREE_GIFT") ? cleanText(set.giftDescription, "Gift description", 180, true) : null,
      closingMode: set.closingMode,
      endsAt: set.closingMode === "DURATION" ? new Date(set.endsAt!) : null,
      orderLimit: set.closingMode === "ORDER_LIMIT" ? Number(set.orderLimit) : null,
      isEnabled: set.isEnabled,
      sortOrder: index,
    };
  });

  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) throw new Error("Campaign start date is invalid.");
  if (endsAt && Number.isNaN(endsAt.getTime())) throw new Error("Campaign end date is invalid.");
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error("Campaign end must be after its start.");

  const saved = await prisma.$transaction(async (tx) => {
    const campaignData = {
      name, slug, status: input.status, announcementMode: input.announcementMode,
      imageUrl: input.imageUrl?.trim() || null, headline,
      caption: cleanText(input.caption, "Announcement caption", 180),
      message: cleanText(input.message, "Announcement message", 800),
      ctaLabel: cleanText(input.ctaLabel, "CTA label", 40, true)!,
      popupEnabled: input.popupEnabled, bannerEnabled: input.bannerEnabled,
      popupSeconds: input.popupSeconds, startsAt, endsAt,
    };
    const campaign = input.id
      ? await tx.promotionCampaign.update({ where: { id: input.id }, data: campaignData })
      : await tx.promotionCampaign.create({ data: campaignData });
    await tx.promotionOfferSet.deleteMany({ where: { campaignId: campaign.id } });
    await tx.promotionOfferSet.createMany({
      data: offerSets.map(({ id: _id, ...set }) => ({ ...set, campaignId: campaign.id })),
    });
    return campaign;
  });

  await logActivity({
    userId: session.user.id,
    action: input.id ? "PROMOTION_CAMPAIGN_UPDATED" : "PROMOTION_CAMPAIGN_CREATED",
    resource: `PromotionCampaign:${saved.id}`,
    metadata: { name: saved.name, slug: saved.slug, status: saved.status, offerSetCount: offerSets.length },
  });
  revalidatePath("/admin/offers");
  revalidatePath("/offers/" + slug);
  revalidateTag("offers");
  revalidateTag("products");
  return { ok: true as const, id: saved.id, slug: saved.slug };
}

export async function updatePromotionCampaignStatus(id: string, status: "DRAFT" | "SCHEDULED" | "LIVE" | "PAUSED" | "ENDED") {
  const session = await requireMarketingAccess();
  const campaign = await prisma.promotionCampaign.update({ where: { id }, data: { status } });
  await logActivity({ userId: session.user.id, action: "PROMOTION_CAMPAIGN_STATUS_UPDATED", resource: `PromotionCampaign:${id}`, metadata: { status } });
  revalidatePath("/admin/offers");
  revalidatePath("/offers/" + campaign.slug);
  revalidateTag("offers");
  revalidateTag("products");
  return { ok: true as const };
}
