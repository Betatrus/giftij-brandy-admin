import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { computePriceAfterDiscount } from "@/lib/pricing/effective-price";

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const rate = checkRateLimit(`public:offer:${getClientIp(req)}`, 60, 60_000);
    if (!rate.allowed) throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    const { slug } = await context.params;
    const now = new Date();
    const { prisma } = await import("@/lib/prisma");
    const campaign = await prisma.offerCampaign.findFirst({
      where: { slug, status: { in: ["PUBLISHED", "ENDED"] } },
      select: {
        id: true, title: true, slug: true, status: true, description: true, announcementHtml: true, creativeImageUrl: true,
        ctaText: true, startsAt: true, endsAt: true, maxQualifyingOrders: true,
        qualifyingOrdersCount: true, reservedQualifyingOrders: true, activeOfferSetId: true,
      },
    });
    if (!campaign) throw new ApiError("NOT_FOUND", "This offer is no longer available.");

    // A published campaign that has ended or exhausted its order cap should
    // render a real customer-facing expired page instead of a generic 404.
    // Future campaigns remain unavailable until their scheduled start.
    if (campaign.status !== "ENDED" && campaign.startsAt && campaign.startsAt > now) {
      throw new ApiError("NOT_FOUND", "This offer has not started yet.");
    }
    const reachedOrderLimit = campaign.maxQualifyingOrders !== null &&
      campaign.qualifyingOrdersCount + campaign.reservedQualifyingOrders >= campaign.maxQualifyingOrders;
    if (campaign.status === "ENDED" || (campaign.endsAt !== null && campaign.endsAt <= now) || reachedOrderLimit) {
      return withCors(ok({
        expired: true,
        campaign: {
          title: campaign.title,
          slug: campaign.slug,
          description: campaign.description,
          endsAt: campaign.endsAt,
          maxQualifyingOrders: campaign.maxQualifyingOrders,
        },
      }), origin);
    }
    if (!campaign.activeOfferSetId) {
      throw new ApiError("NOT_FOUND", "This offer is no longer available.");
    }

    const availableSets = await prisma.offerSet.findMany({
      where: { campaignId: campaign.id, isEnabled: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, description: true },
    });
    const requestedSetId = req.nextUrl.searchParams.get("set");
    const selectedSetId = requestedSetId ?? campaign.activeOfferSetId;
    if (!availableSets.some((set) => set.id === selectedSetId)) {
      throw new ApiError("NOT_FOUND", "That Offer Set is not available in this campaign.");
    }

    const offerSet = await prisma.offerSet.findFirst({
      where: { id: selectedSetId, campaignId: campaign.id, isEnabled: true },
      select: {
        id: true, title: true, description: true,
        products: {
          orderBy: { createdAt: "asc" },
          select: {
            discountPercent: true, discountAmount: true, freeDelivery: true, giftDescription: true,
            product: { select: { id: true, slug: true, name: true, price: true, discount: true, discountType: true, discountAmount: true, status: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altText: true } } } },
          },
        },
      },
    });
    if (!offerSet) throw new ApiError("NOT_FOUND", "This offer is no longer available.");
    const products = offerSet.products.filter((item) => item.product && item.product.status === "ACTIVE").map((item) => {
      const basePrice = Number(item.product.price);
      const discountPercent = item.discountPercent === null ? null : Number(item.discountPercent);
      const discountAmount = item.discountAmount === null ? null : Number(item.discountAmount);
      const productDiscount = {
        type: item.product.discountType as "PERCENTAGE" | "FIXED",
        percent: Number(item.product.discount ?? 0),
        amount: item.product.discountAmount === null ? null : Number(item.product.discountAmount),
      };
      const offerDiscount = discountPercent !== null
        ? { type: "PERCENTAGE" as const, percent: discountPercent }
        : discountAmount !== null
          ? { type: "FIXED" as const, amount: discountAmount }
          : productDiscount;
      return {
        slug: item.product.slug,
        name: item.product.name,
        basePrice,
        offerPrice: computePriceAfterDiscount(basePrice, offerDiscount),
        discountPercent,
        discountAmount,
        freeDelivery: item.freeDelivery,
        giftDescription: item.giftDescription,
        image: item.product.images[0]?.url ?? null,
        imageAlt: item.product.images[0]?.altText ?? item.product.name,
      };
    });
    if (products.length === 0) throw new ApiError("NOT_FOUND", "This Offer Set has no available products.");
    return withCors(ok({
      campaign: {
        title: campaign.title, slug: campaign.slug, description: campaign.description,
        announcementHtml: campaign.announcementHtml,
        creativeImageUrl: campaign.creativeImageUrl, ctaText: campaign.ctaText,
        startsAt: campaign.startsAt, endsAt: campaign.endsAt,
        maxQualifyingOrders: campaign.maxQualifyingOrders,
        qualifyingOrdersCount: campaign.qualifyingOrdersCount,
        defaultOfferSetId: campaign.activeOfferSetId,
      },
      offerSets: availableSets,
      offerSet: { id: offerSet.id, title: offerSet.title, description: offerSet.description },
      products,
    }), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
