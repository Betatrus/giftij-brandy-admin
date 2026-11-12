-- Ensure the yearly sequential order-number counter exists for this release.
-- Production already has this table from the previously applied
-- 20261029172544_add_order_number_counter migration, so this is a no-op there.
-- Keep this additive guard for environments where the historical migration
-- source is absent; do not recreate or reset the existing Production table.
CREATE TABLE IF NOT EXISTS "OrderNumberCounter" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderNumberCounter_pkey" PRIMARY KEY ("year")
);
