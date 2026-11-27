-- Additive storefront checkout lock settings. Browsing remains available.
ALTER TABLE "StoreSettings"
  ADD COLUMN IF NOT EXISTS "checkoutLocked" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "checkoutLockMessage" TEXT;
