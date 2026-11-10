import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api/api-error";
import { computeEffectivePrice } from "@/lib/pricing/effective-price";
import type { CartLine } from "@/lib/orders/stock";

export interface ResolvedCartLine extends CartLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  name: string;
  offerCampaignId: string | null;
  offerSetId: string | null;
}

/** Resolve all product, variant, campaign and price data from the database. */
export async function resolveCartLines(
  cart: { productSlug: string; sku?: string; quantity: number; offerCampaignSlug?: string; offerSetId?: string }[],
): Promise<ResolvedCartLine[]> {
  const slugs = [...new Set(cart.map((line) => line.productSlug))];
  const offerSlugs = [...new Set(cart.map((line) => line.offerCampaignSlug).filter((value): value is string => Boolean(value)))];

  if (cart.some((line) => line.offerSetId && !line.offerCampaignSlug)) {
    throw new ApiError("VALIDATION_ERROR", "An Offer Set can only be used with its Offer Campaign.");
  }
  if (offerSlugs.length > 1) {
    throw new ApiError("VALIDATION_ERROR", "A checkout can contain products from only one Offer Campaign at a time.");
  }

  const products = await prisma.product.findMany({
    where: { slug: { in: slugs }, status: "ACTIVE" },
    select: {
      id: true, slug: true, name: true, price: true, discount: true,
      variants: { select: { id: true, sku: true, status: true } },
    },
  });
  const productBySlug = new Map(products.map((product) => [product.slug, product]));

  let campaignId: string | null = null;
  let defaultOfferSetId: string | null = null;
  let offerRuleBySetAndProduct = new Map<string, { discountPercent: number | null }>();
  if (offerSlugs.length === 1) {
    const now = new Date();
    const campaign = await prisma.offerCampaign.findFirst({
      where: {
        slug: offerSlugs[0],
        status: "PUBLISHED",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      select: {
        id: true, activeOfferSetId: true, maxQualifyingOrders: true,
        qualifyingOrdersCount: true, reservedQualifyingOrders: true,
      },
    });
    if (!campaign || !campaign.activeOfferSetId || (
      campaign.maxQualifyingOrders !== null &&
      campaign.qualifyingOrdersCount + campaign.reservedQualifyingOrders >= campaign.maxQualifyingOrders
    )) {
      throw new ApiError("OFFER_UNAVAILABLE", "This offer has ended or is no longer available. Please refresh the campaign page.");
    }
    defaultOfferSetId = campaign.activeOfferSetId;
    const selectedSetIds = [...new Set(
      cart.filter((line) => line.offerCampaignSlug).map((line) => line.offerSetId ?? defaultOfferSetId),
    )].filter((id): id is string => Boolean(id));
    const activeSets = await prisma.offerSet.findMany({
      where: { id: { in: selectedSetIds }, campaignId: campaign.id, isEnabled: true },
      select: { id: true },
    });
    if (activeSets.length !== selectedSetIds.length) {
      throw new ApiError("OFFER_UNAVAILABLE", "One of the selected Offer Sets is no longer available.");
    }
    const rules = await prisma.offerSetProduct.findMany({
      where: {
        offerSetId: { in: selectedSetIds },
        productId: { in: products.map((product) => product.id) },
      },
      select: { offerSetId: true, productId: true, discountPercent: true },
    });
    offerRuleBySetAndProduct = new Map(rules.map((rule) => [`${rule.offerSetId}:${rule.productId}`, {
      discountPercent: rule.discountPercent === null ? null : Number(rule.discountPercent),
    }]));
    campaignId = campaign.id;
  }

  return cart.map((line) => {
    const product = productBySlug.get(line.productSlug);
    if (!product) throw new ApiError("NOT_FOUND", `Product "${line.productSlug}" is no longer available.`);

    let discountPercent = product.discount ? Number(product.discount) : 0;
    if (line.offerCampaignSlug) {
      const lineOfferSetId = line.offerSetId ?? defaultOfferSetId;
      const rule = lineOfferSetId ? offerRuleBySetAndProduct.get(`${lineOfferSetId}:${product.id}`) : undefined;
      if (!rule) throw new ApiError("OFFER_UNAVAILABLE", `"${product.name}" is not included in the currently selected Offer Set.`);
      if (rule.discountPercent !== null) discountPercent = rule.discountPercent;
    }
    const unitPrice = computeEffectivePrice(Number(product.price), discountPercent);

    if (line.sku) {
      const variant = product.variants.find((item) => item.sku === line.sku);
      if (!variant || variant.status === "ARCHIVED") {
        throw new ApiError("NOT_FOUND", `The selected option for "${product.name}" is no longer available.`);
      }
      return { productId: product.id, variantId: variant.id, quantity: line.quantity, unitPrice, name: product.name, offerCampaignId: line.offerCampaignSlug ? campaignId : null, offerSetId: line.offerCampaignSlug ? (line.offerSetId ?? defaultOfferSetId) : null };
    }

    if (product.variants.length > 0) {
      throw new ApiError("VALIDATION_ERROR", `"${product.name}" requires a selected option (colour/size).`);
    }
    return { productId: product.id, variantId: null, quantity: line.quantity, unitPrice, name: product.name, offerCampaignId: line.offerCampaignSlug ? campaignId : null, offerSetId: line.offerCampaignSlug ? (line.offerSetId ?? defaultOfferSetId) : null };
  });
}
