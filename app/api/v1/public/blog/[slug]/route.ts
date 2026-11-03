import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { hasValidStorefrontKey, storefrontUnauthorizedResponse } from "@/lib/api/storefront-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const origin = req.headers.get("origin");
  if (!hasValidStorefrontKey(req)) return withCors(storefrontUnauthorizedResponse(), origin);
  try {
    const { slug } = await params;
    const now = new Date();
    const post = await prisma.blogPost.findFirst({
      where: { slug, status: "PUBLISHED", publishedAt: { lte: now } },
      select: {
        id: true, title: true, slug: true, excerpt: true, contentMarkdown: true, type: true,
        tags: true, coverImageUrl: true, coverImageAlt: true, seoTitle: true, seoDescription: true,
        canonicalUrl: true, isFeatured: true, isIndexable: true, publishedAt: true, updatedAt: true,
        category: { select: { name: true, slug: true, description: true, seoTitle: true, seoDescription: true } },
      },
    });
    if (post) {
      const settings = await prisma.storeSettings.findUnique({ where: { id: "singleton" }, select: { blogIndexingEnabled: true } });
      return withCors(ok({ ...post, isIndexable: Boolean(settings?.blogIndexingEnabled && post.isIndexable) }), origin);
    }
    const redirect = await prisma.blogPostSlugRedirect.findUnique({
      where: { fromSlug: slug }, include: { post: { select: { slug: true, status: true, publishedAt: true } } },
    });
    if (redirect?.post.status === "PUBLISHED" && redirect.post.publishedAt && redirect.post.publishedAt <= now) {
      return withCors(Response.json({ success: true, redirectTo: redirect.post.slug }, { headers: { "Cache-Control": "no-store" } }), origin);
    }
    return withCors(Response.json({ success: false, error: { code: "NOT_FOUND", message: "Article not found." } }, { status: 404 }), origin);
  } catch (error) { return withCors(fail(error), origin); }
}
export async function OPTIONS(req: NextRequest) { return corsPreflight(req.headers.get("origin")); }
