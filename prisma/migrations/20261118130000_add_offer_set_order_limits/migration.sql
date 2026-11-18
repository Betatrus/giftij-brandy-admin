ALTER TABLE "OfferSet"
  ADD COLUMN "maxQualifyingOrders" INTEGER,
  ADD COLUMN "qualifyingOrdersCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservedQualifyingOrders" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CheckoutReservation"
  ADD COLUMN "offerSetId" TEXT;

ALTER TABLE "CheckoutReservation"
  ADD CONSTRAINT "CheckoutReservation_offerSetId_fkey"
  FOREIGN KEY ("offerSetId") REFERENCES "OfferSet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CheckoutReservation_offerSetId_idx"
  ON "CheckoutReservation"("offerSetId");
