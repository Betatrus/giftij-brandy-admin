"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";\nimport { createSignedBlogUpload, getImageResource, isBlogMediaCloudinaryId } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";

async function requireEditor() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (session.user.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
  return session;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}

function required(value: string, label: string, max: number) {
  const clean = value.trim();
  if (!clean) throw new Error(label + " is required.");
  if (clean.length > max) throw new Error(label + " is too long.");
  return clean;
}

async function refreshBlog() {
  for (const path of ["/admin/blog", "/blog", "/sitemap.xml"]) revalidatePath(path);
}

export async function saveBlogPost(input: {
  id?: string; title: string; slug: string; excerpt: string; contentMarkdown: string;
  type: "GUIDE" | "CUSTOMER_STORY" | "FAQ" | "ANNOUNCEMENT";
  categoryId?: string; tags: string; coverImageUrl?: string; coverImageAlt?: string;
  seoTitle?: string; seoDescription?: string; canonicalUrl?: string;
  isFeatured: boolean; isIndexable: boolean; intent: "DRAFT" | "PUBLISH";
}) {
  const session = await requireEditor();
  const title = required(input.title, "Title", 120);
  const slug = slugify(input.slug || title);
  const excerpt = required(input.excerpt, "Excerpt", 320);
  const contentMarkdown = required(input.contentMarkdown, "Article content", 50000);
  if (!slug) throw new Error("A valid URL slug is required.");
  const collision = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
  if (collision && collision.id !== input.id) throw new Error("That article URL is already in use.");
  if (input.seoTitle && input.seoTitle.length > 70) throw new Error("SEO title must be 70 characters or fewer.");
  if (input.seoDescription && input.seoDescription.length > 170) throw new Error("SEO description must be 170 characters or fewer.");
  if (input.canonicalUrl?.trim()) {
    let parsed: URL;
    try { parsed = new URL(input.canonicalUrl.trim()); } catch { throw new Error("Canonical URL must be a valid absolute URL."); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Canonical URL must use HTTP or HTTPS.");
  }
  if (input.categoryId) {
    const category = await prisma.blogCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new Error("Selected category was not found.");
  }
  const tags = Array.from(new Set(input.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 12);
  const status = input.intent === "PUBLISH" ? "PUBLISHED" : "DRAFT";

  const post = await prisma.$transaction(async (tx) => {
    const existing = input.id ? await tx.blogPost.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !existing) throw new Error("Article not found.");
    if (existing && existing.slug !== slug && existing.status === "PUBLISHED") {
      await tx.blogPostSlugRedirect.upsert({
        where: { fromSlug: existing.slug },
        update: { postId: existing.id },
        create: { fromSlug: existing.slug, postId: existing.id },
      });
    }
    const data = {
      title, slug, excerpt, contentMarkdown, type: input.type, status,
      categoryId: input.categoryId || null, tags,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      coverImageAlt: input.coverImageAlt?.trim() || null,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      canonicalUrl: input.canonicalUrl?.trim() || null,
      isFeatured: input.isFeatured, isIndexable: input.isIndexable,
      ...(status === "PUBLISHED" ? { publishedAt: existing?.publishedAt ?? new Date() } : {}),
      ...(status === "DRAFT" ? { publishedAt: null } : {}),
      ...(existing ? {} : { authorId: session.user.id }),
    };
    return existing
      ? tx.blogPost.update({ where: { id: existing.id }, data })
      : tx.blogPost.create({ data });
  });

  await logActivity({
    userId: session.user.id,
    action: input.intent === "PUBLISH" ? "BLOG_POST_PUBLISHED" : (input.id ? "BLOG_POST_UPDATED" : "BLOG_POST_CREATED"),
    resource: `BlogPost:${post.id}`,
    metadata: { title: post.title, slug: post.slug, status: post.status },
  });
  await refreshBlog();
  return { ok: true as const, id: post.id };
}

export async function createBlogCategory(input: { name: string; description?: string }) {
  const session = await requireEditor();
  const name = required(input.name, "Category name", 60);
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (await prisma.blogCategory.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${suffix++}`;
  const category = await prisma.blogCategory.create({ data: { name, slug, description: input.description?.trim() || null } });
  await logActivity({ userId: session.user.id, action: "BLOG_CATEGORY_CREATED", resource: `BlogCategory:${category.id}`, metadata: { name, slug } });
  revalidatePath("/admin/blog");
  return { id: category.id, name: category.name };
}

export async function archiveBlogPost(id: string) {
  const session = await requireEditor();
  const post = await prisma.blogPost.update({ where: { id }, data: { status: "ARCHIVED", isIndexable: false } });
  await logActivity({ userId: session.user.id, action: "BLOG_POST_ARCHIVED", resource: `BlogPost:${id}`, metadata: { slug: post.slug } });
  await refreshBlog();
}

export async function updateBlogVisibility(input: { navigationVisible: boolean; indexingEnabled: boolean }) {
  const session = await requireEditor();
  await prisma.storeSettings.upsert({
    where: { id: "singleton" },
    update: { blogNavigationVisible: input.navigationVisible, blogIndexingEnabled: input.indexingEnabled },
    create: { id: "singleton", blogNavigationVisible: input.navigationVisible, blogIndexingEnabled: input.indexingEnabled },
  });
  await logActivity({ userId: session.user.id, action: "BLOG_VISIBILITY_SETTINGS_UPDATED", resource: "StoreSettings:singleton", metadata: input });
  for (const path of ["/admin/settings", "/blog", "/sitemap.xml"]) revalidatePath(path);
}

export async function getBlogCloudinaryUploadSignature() {
  await requireEditor();
  return createSignedBlogUpload();
}

export async function attachBlogCoverImage(input: { postId: string; cloudinaryId: string }) {
  const session = await requireEditor();
  if (!isBlogMediaCloudinaryId(input.cloudinaryId)) throw new Error("Invalid blog image asset.");
  const asset = await getImageResource(input.cloudinaryId);
  if (!isBlogMediaCloudinaryId(asset.cloudinaryId)) throw new Error("Invalid blog image asset.");
  const post = await prisma.blogPost.update({
    where: { id: input.postId },
    data: { coverImageUrl: asset.url, coverImagePublicId: asset.cloudinaryId },
    select: { id: true, coverImageUrl: true, coverImagePublicId: true },
  });
  await logActivity({
    userId: session.user.id,
    action: "BLOG_COVER_IMAGE_UPLOADED",
    resource: `BlogPost:${post.id}`,
    metadata: { cloudinaryId: post.coverImagePublicId },
  });
  revalidatePath("/admin/blog");
  return { url: post.coverImageUrl, cloudinaryId: post.coverImagePublicId };
}
