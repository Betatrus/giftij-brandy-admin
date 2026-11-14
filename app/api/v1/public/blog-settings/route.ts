import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const { prisma } = await import("@/lib/prisma");
    const settings = await prisma.storeSettings.findUnique({ where: { id: "singleton" }, select: { blogNavigationVisible: true, blogIndexingEnabled: true } });
    return withCors(ok({ blogNavigationVisible: settings?.blogNavigationVisible ?? false, blogIndexingEnabled: settings?.blogIndexingEnabled ?? false }), origin);
  } catch (error) { return withCors(fail(error), origin); }
}
export async function OPTIONS(req: NextRequest) { return corsPreflight(req.headers.get("origin")); }
