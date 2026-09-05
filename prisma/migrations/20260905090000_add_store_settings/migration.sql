-- CreateTable
-- Adds a single new table for store-level settings (currently just the
-- Customer Care WhatsApp number). No existing table, column, index, or
-- constraint is touched — purely additive, same as the Phase 9
-- color/size migration.
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "customerCareWhatsApp" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);
