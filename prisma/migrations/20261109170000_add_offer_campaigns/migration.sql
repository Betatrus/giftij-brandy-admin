CREATE TYPE "OfferCampaignStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED');
CREATE TYPE "OfferBenefitType" AS ENUM ('DISCOUNT', 'FREE_DELIVERY', 'GIFT');

CREATE TABLE "OfferCampaign" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "announcementHtml" TEXT,
  "creativeImageUrl" TEXT,
  "ctaText" TEXT NOT NULL DEFAULT 'Shop the offer',
  "status" "OfferCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "maxQualifyingOrders" INTEGER,
  "qualifyingOrdersCount" INTEGER NOT NULL DEFAULT 0,
  "activeOfferSetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfferCampaign_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OfferSet" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfferSet_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OfferSetProduct" (
  "id" TEXT NOT NULL,
  "offerSetId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "discountPercent" DECIMAL(5,2),
  "freeDelivery" BOOLEAN NOT NULL DEFAULT false,
  "giftDescription" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfferSetProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfferCampaign_slug_key" ON "OfferCampaign"("slug");
CREATE INDEX "OfferCampaign_status_startsAt_endsAt_idx" ON "OfferCampaign"("status", "startsAt", "endsAt");
CREATE INDEX "OfferSet_campaignId_sortOrder_idx" ON "OfferSet"("campaignId", "sortOrder");
CREATE UNIQUE INDEX "OfferSetProduct_offerSetId_productId_key" ON "OfferSetProduct"("offerSetId", "productId");
CREATE INDEX "OfferSetProduct_productId_idx" ON "OfferSetProduct"("productId");
ALTER TABLE "OfferSet" ADD CONSTRAINT "OfferSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OfferCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferSetProduct" ADD CONSTRAINT "OfferSetProduct_offerSetId_fkey" FOREIGN KEY ("offerSetId") REFERENCES "OfferSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferSetProduct" ADD CONSTRAINT "OfferSetProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
