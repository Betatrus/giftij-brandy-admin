-- Create the Giftij Brandy editorial CMS and safe blog visibility controls.
-- Existing store, order, payment, reservation and inventory records are untouched.

CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "BlogPostType" AS ENUM ('GUIDE', 'CUSTOMER_STORY', 'FAQ', 'ANNOUNCEMENT');

ALTER TABLE "StoreSettings"
  ADD COLUMN "blogNavigationVisible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blogIndexingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BlogCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogPost" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "type" "BlogPostType" NOT NULL DEFAULT 'GUIDE',
  "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
  "categoryId" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "coverImageUrl" TEXT,
  "coverImagePublicId" TEXT,
  "coverImageAlt" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "canonicalUrl" TEXT,
  "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "isIndexable" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "authorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogPostSlugRedirect" (
  "id" TEXT NOT NULL,
  "fromSlug" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogPostSlugRedirect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogCategory_slug_key" ON "BlogCategory"("slug");
CREATE INDEX "BlogCategory_isActive_sortOrder_idx" ON "BlogCategory"("isActive", "sortOrder");

CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");
CREATE INDEX "BlogPost_categoryId_status_idx" ON "BlogPost"("categoryId", "status");
CREATE INDEX "BlogPost_type_status_idx" ON "BlogPost"("type", "status");
CREATE INDEX "BlogPost_authorId_idx" ON "BlogPost"("authorId");
CREATE INDEX "BlogPost_isFeatured_status_publishedAt_idx" ON "BlogPost"("isFeatured", "status", "publishedAt");

CREATE UNIQUE INDEX "BlogPostSlugRedirect_fromSlug_key" ON "BlogPostSlugRedirect"("fromSlug");
CREATE INDEX "BlogPostSlugRedirect_postId_idx" ON "BlogPostSlugRedirect"("postId");

ALTER TABLE "BlogPost"
  ADD CONSTRAINT "BlogPost_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlogPost"
  ADD CONSTRAINT "BlogPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlogPostSlugRedirect"
  ADD CONSTRAINT "BlogPostSlugRedirect_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "BlogPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
