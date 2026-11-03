import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const now = new Date();
    const [settings, posts] = await Promise.all([
      prisma.storeSettings.findUnique({ where: { id: "singleton" }, select: { blogIndexingEnabled: true } }),
      prisma.blogPost.findMany({
        where: { status: "PUBLISHED", publishedAt: { lte: now } },
        orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
        select: {
          id: true, title: true, slug: true, excerpt: true, type: true, tags: true,
          coverImageUrl: true, coverImageAlt: true, seoTitle: true, seoDescription: true,
          canonicalUrl: true, isFeatured: true, isIndexable: true, publishedAt: true,
          updatedAt: true, category: { select: { name: true, slug: true, description: true, seoTitle: true, seoDescription: true } },
        },
      }),
    ]);
    const indexingEnabled = settings?.blogIndexingEnabled ?? false;
    return withCors(ok(posts.map(post => ({ ...post, isIndexable: indexingEnabled && post.isIndexable }))), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}
export async function OPTIONS(req: NextRequest) { return corsPreflight(req.headers.get("origin")); }
