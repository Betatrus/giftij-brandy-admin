import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

const getPublicOffer = unstable_cache(async (slug: string) => {
  const now = new Date();
  const campaign = await prisma.promotionCampaign.findFirst({
    where: {
      slug,
      status: "LIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    include: { offerSets: { where: { isEnabled: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) return null;

  const visibleSets = campaign.offerSets.filter((set) => {
    if (set.closingMode === "DURATION" && set.endsAt && set.endsAt <= now) return false;
    if (set.closingMode === "ORDER_LIMIT" && set.orderLimit !== null && set.paidOrders >= set.orderLimit) return false;
    return true;
  });
  const ids = Array.from(new Set(visibleSets.flatMap((set) => set.productIds)));
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: {
      id: true, slug: true, name: true, price: true, discount: true,
      images: { where: { imageType: "COVER" }, take: 1, select: { url: true, altText: true } },
      inventory: { select: { currentStock: true, reservedStock: true } },
      variants: { where: { status: "ACTIVE" }, select: { id: true, value: true, currentStock: true, reservedStock: true } },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return {
    id: campaign.id, name: campaign.name, slug: campaign.slug, headline: campaign.headline,
    caption: campaign.caption, message: campaign.message, announcementMode: campaign.announcementMode,
    imageUrl: campaign.imageUrl, ctaLabel: campaign.ctaLabel, startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    offerSets: visibleSets.map((set) => ({
      id: set.id, name: set.name, description: set.description, benefits: set.benefits,
      discountType: set.discountType, discountValue: set.discountValue === null ? null : Number(set.discountValue),
      giftDescription: set.giftDescription, closingMode: set.closingMode,
      endsAt: set.endsAt, orderLimit: set.orderLimit, paidOrders: set.paidOrders,
      products: set.productIds.map((id) => byId.get(id)).filter(Boolean).map((product) => ({
        id: product!.id, slug: product!.slug, name: product!.name,
        price: Number(product!.price), discount: Number(product!.discount ?? 0),
        image: product!.images[0] ?? null,
        available: product!.variants.length
          ? product!.variants.reduce((sum, v) => sum + Math.max(0, v.currentStock - v.reservedStock), 0)
          : Math.max(0, (product!.inventory?.currentStock ?? 0) - (product!.inventory?.reservedStock ?? 0)),
      })),
    })),
  };
}, ["public-promotion-campaign-v1"], { revalidate: 30, tags: ["offers", "products"] });

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`public:offer:${ip}`, 90, 60_000).allowed) {
      return withCors(fail({ code: "RATE_LIMITED", message: "Too many requests." }), origin);
    }
    const { slug } = await context.params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 90) {
      return withCors(fail({ code: "NOT_FOUND", message: "Offer not found." }), origin);
    }
    const campaign = await getPublicOffer(slug);
    if (!campaign) return withCors(fail({ code: "NOT_FOUND", message: "This offer has ended or is unavailable." }), origin);
    return withCors(ok(campaign), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
