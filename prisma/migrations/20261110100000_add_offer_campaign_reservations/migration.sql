-- Add campaign-level reservation accounting without rewriting the original campaign migration.
ALTER TABLE "OfferCampaign" ADD COLUMN "reservedQualifyingOrders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CheckoutReservation" ADD COLUMN "offerCampaignId" TEXT;
CREATE INDEX "CheckoutReservation_offerCampaignId_idx" ON "CheckoutReservation"("offerCampaignId");
ALTER TABLE "CheckoutReservation" ADD CONSTRAINT "CheckoutReservation_offerCampaignId_fkey" FOREIGN KEY ("offerCampaignId") REFERENCES "OfferCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
