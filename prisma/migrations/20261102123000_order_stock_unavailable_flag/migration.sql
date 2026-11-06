-- Distinguish a paid order awaiting stock resolution from ordinary PAID orders.
ALTER TABLE "Order"
ADD COLUMN "stockUnavailable" BOOLEAN NOT NULL DEFAULT false;
