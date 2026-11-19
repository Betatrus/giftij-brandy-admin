import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { computePriceAfterDiscount } from "@/lib/pricing/effective-price";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) {
    return withCors(storefrontUnauthorizedResponse(), origin);
  }

  try {
    if (!checkRateLimit(`public:offer-directory:${getClientIp(req)}`, 60, 60_000).allowed) {
      return withCors(fail({ code: "RATE_LIMITED", message: "Too many requests." }), origin);
    }

    const now = new Date();
    const campaigns = await prisma.offerCampaign.findMany({
      where: {
        status: "PUBLISHED",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        creativeImageUrl: true,
        ctaText: true,
        startsAt: true,
        endsAt: true,
        maxQualifyingOrders: true,
        qualifyingOrdersCount: true,
        reservedQualifyingOrders: true,
        offerSets: {
          where: { isEnabled: true },
          select: {
            id: true,
            maxQualifyingOrders: true,
            qualifyingOrdersCount: true,
            reservedQualifyingOrders: true,
            products: {
              orderBy: { createdAt: "asc" },
              select: {
                discountPercent: true,
                discountAmount: true,
                freeDelivery: true,
                giftDescription: true,
                product: {
                  select: {
                    slug: true, name: true, price: true, discount: true,
                    discountType: true, discountAmount: true, status: true,
                    images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altText: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const activeCampaigns = campaigns
      .filter((campaign) => {
        const campaignHasCapacity =
          campaign.maxQualifyingOrders === null ||
          campaign.qualifyingOrdersCount + campaign.reservedQualifyingOrders < campaign.maxQualifyingOrders;
        const hasAvailableOfferSet = campaign.offerSets.some((set) =>
          set.maxQualifyingOrders === null ||
          set.qualifyingOrdersCount + set.reservedQualifyingOrders < set.maxQualifyingOrders
        );
        return campaignHasCapacity && hasAvailableOfferSet;
      })
      .map(({ id, title, slug, description, creativeImageUrl, ctaText, startsAt, endsAt, offerSets }) => ({
        id, title, slug, description, creativeImageUrl, ctaText, startsAt, endsAt,
        url: `/offers/${slug}`,
        products: offerSets.flatMap((set) => set.products
          .filter((item) => item.product && item.product.status === "ACTIVE")
          .map((item) => {
            const product = item.product;
            const basePrice = Number(product.price);
            const discountPercent = item.discountPercent === null ? null : Number(item.discountPercent);
            const discountAmount = item.discountAmount === null ? null : Number(item.discountAmount);
            const productDiscount = {
              type: product.discountType as "PERCENTAGE" | "FIXED",
              percent: Number(product.discount ?? 0),
              amount: product.discountAmount === null ? null : Number(product.discountAmount),
            };
            const offerDiscount = discountPercent !== null
              ? { type: "PERCENTAGE" as const, percent: discountPercent }
              : discountAmount !== null
                ? { type: "FIXED" as const, amount: discountAmount }
                : productDiscount;
            return {
              slug: product.slug, name: product.name, basePrice,
              offerSetId: set.id,
              offerPrice: computePriceAfterDiscount(basePrice, offerDiscount),
              discountPercent, discountAmount, freeDelivery: item.freeDelivery,
              giftDescription: item.giftDescription,
              image: product.images[0]?.url ?? null,
              imageAlt: product.images[0]?.altText ?? product.name,
            };
          })),
      })).filter((campaign) => campaign.products.length > 0);

    return withCors(ok(activeCampaigns), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
