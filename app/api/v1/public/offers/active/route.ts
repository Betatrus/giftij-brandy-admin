import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

const getActiveAnnouncements = unstable_cache(async () => {
  const now = new Date();
  return prisma.promotionCampaign.findMany({
    where: {
      status: "LIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
      OR: [{ popupEnabled: true }, { bannerEnabled: true }],
    },
    select: {
      id: true, name: true, slug: true, headline: true, caption: true, message: true,
      imageUrl: true, announcementMode: true, ctaLabel: true, popupEnabled: true,
      bannerEnabled: true, popupSeconds: true,
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
}, ["active-promotion-announcements-v1"], { revalidate: 30, tags: ["offers"] });

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`public:offer-announcement:${ip}`, 60, 60_000).allowed) {
      return withCors(fail({ code: "RATE_LIMITED", message: "Too many requests." }), origin);
    }
    return withCors(ok(await getActiveAnnouncements()), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
