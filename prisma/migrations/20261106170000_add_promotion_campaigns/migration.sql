CREATE TYPE "PromotionCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED');

CREATE TABLE "PromotionCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "PromotionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "announcementMode" TEXT NOT NULL DEFAULT 'HTML',
  "imageUrl" TEXT,
  "headline" TEXT NOT NULL,
  "caption" TEXT,
  "message" TEXT,
  "ctaLabel" TEXT NOT NULL DEFAULT 'Explore offers',
  "popupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "bannerEnabled" BOOLEAN NOT NULL DEFAULT false,
  "popupSeconds" INTEGER NOT NULL DEFAULT 6,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionOfferSet" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "discountType" TEXT,
  "discountValue" DECIMAL(12,2),
  "giftDescription" TEXT,
  "closingMode" TEXT NOT NULL DEFAULT 'DURATION',
  "endsAt" TIMESTAMP(3),
  "orderLimit" INTEGER,
  "paidOrders" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromotionOfferSet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionOfferSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PromotionCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromotionCampaign_slug_key" ON "PromotionCampaign"("slug");
CREATE INDEX "PromotionCampaign_status_startsAt_endsAt_idx" ON "PromotionCampaign"("status", "startsAt", "endsAt");
CREATE INDEX "PromotionOfferSet_campaignId_isEnabled_sortOrder_idx" ON "PromotionOfferSet"("campaignId", "isEnabled", "sortOrder");
CREATE INDEX "PromotionOfferSet_closingMode_endsAt_idx" ON "PromotionOfferSet"("closingMode", "endsAt");
