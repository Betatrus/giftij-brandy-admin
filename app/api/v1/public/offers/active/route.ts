import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);

  try {
    if (!checkRateLimit(`public:active-offers:${getClientIp(req)}`, 60, 60_000).allowed) {
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
      take: 10,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        announcementHtml: true,
        creativeImageUrl: true,
        ctaText: true,
        startsAt: true,
        endsAt: true,
        maxQualifyingOrders: true,
        qualifyingOrdersCount: true,
        reservedQualifyingOrders: true,
        activeOfferSetId: true,
        offerSets: {
          where: { isEnabled: true },
          select: {
            id: true,
            maxQualifyingOrders: true,
            qualifyingOrdersCount: true,
            reservedQualifyingOrders: true,
          },
        },
      },
    });

    const active = campaigns.find((campaign) => {
      const campaignHasCapacity =
        campaign.maxQualifyingOrders === null ||
        campaign.qualifyingOrdersCount + campaign.reservedQualifyingOrders < campaign.maxQualifyingOrders;
      const availableSets = campaign.offerSets.filter((set) =>
        set.maxQualifyingOrders === null ||
        set.qualifyingOrdersCount + set.reservedQualifyingOrders < set.maxQualifyingOrders
      );
      return campaignHasCapacity;
    });

    if (!active) return withCors(ok(null), origin);

    return withCors(ok({
      id: active.id,
      title: active.title,
      slug: active.slug,
      description: active.description,
      announcementHtml: active.announcementHtml,
      creativeImageUrl: active.creativeImageUrl,
      ctaText: active.ctaText,
      startsAt: active.startsAt,
      endsAt: active.endsAt,
      url: `/offers/${active.slug}`,
    }), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
