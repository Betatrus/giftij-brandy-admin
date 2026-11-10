import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { computeEffectivePrice } from "@/lib/pricing/effective-price";

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const rate = checkRateLimit(`public:offer:${getClientIp(req)}`, 60, 60_000);
    if (!rate.allowed) throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    const { slug } = await context.params;
    const now = new Date();
    const campaign = await prisma.offerCampaign.findFirst({
      where: {
        slug,
        status: "PUBLISHED",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      select: {
        id: true, title: true, slug: true, description: true, creativeImageUrl: true,
        ctaText: true, startsAt: true, endsAt: true, maxQualifyingOrders: true,
        qualifyingOrdersCount: true, reservedQualifyingOrders: true, activeOfferSetId: true,
      },
    });
    if (!campaign || !campaign.activeOfferSetId || (
      campaign.maxQualifyingOrders !== null &&
      campaign.qualifyingOrdersCount + campaign.reservedQualifyingOrders >= campaign.maxQualifyingOrders
    )) throw new ApiError("NOT_FOUND", "This offer is no longer available.");

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
            discountPercent: true, freeDelivery: true, giftDescription: true,
            product: { select: { id: true, slug: true, name: true, price: true, discount: true, status: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altText: true } } } },
          },
        },
      },
    });
    if (!offerSet) throw new ApiError("NOT_FOUND", "This offer is no longer available.");
    const products = offerSet.products.filter((item) => item.product && item.product.status === "ACTIVE").map((item) => {
      const basePrice = Number(item.product.price);
      const discountPercent = item.discountPercent === null ? null : Number(item.discountPercent);
      return {
        slug: item.product.slug,
        name: item.product.name,
        basePrice,
        offerPrice: discountPercent === null ? computeEffectivePrice(basePrice, Number(item.product.discount ?? 0)) : computeEffectivePrice(basePrice, discountPercent),
        discountPercent,
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
        creativeImageUrl: campaign.creativeImageUrl, ctaText: campaign.ctaText,
        startsAt: campaign.startsAt, endsAt: campaign.endsAt,
        maxQualifyingOrders: campaign.maxQualifyingOrders,
        qualifyingOrdersCount: campaign.qualifyingOrdersCount,
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
