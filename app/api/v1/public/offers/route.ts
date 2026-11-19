import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
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
            maxQualifyingOrders: true,
            qualifyingOrdersCount: true,
            reservedQualifyingOrders: true,
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
      .map(({ id, title, slug, description, creativeImageUrl, ctaText, startsAt, endsAt }) => ({
        id,
        title,
        slug,
        description,
        creativeImageUrl,
        ctaText,
        startsAt,
        endsAt,
        url: `/offers/${slug}`,
      }));

    return withCors(ok(activeCampaigns), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
