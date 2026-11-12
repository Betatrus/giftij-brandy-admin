-- Add the yearly sequential order-number counter.
-- IF NOT EXISTS keeps this safe if the table was created during earlier staging.
CREATE TABLE IF NOT EXISTS "OrderNumberCounter" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderNumberCounter_pkey" PRIMARY KEY ("year")
);
