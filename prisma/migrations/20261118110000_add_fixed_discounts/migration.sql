CREATE TYPE "ProductDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

ALTER TABLE "Product"
  ADD COLUMN "discountType" "ProductDiscountType" NOT NULL DEFAULT 'PERCENTAGE',
  ADD COLUMN "discountAmount" DECIMAL(12,2);

ALTER TABLE "OfferSetProduct"
  ADD COLUMN "discountAmount" DECIMAL(12,2);
