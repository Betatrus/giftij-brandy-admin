ALTER TABLE "StoreSettings"
  ADD COLUMN "storefrontLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "storefrontLockMessage" TEXT,
  ADD COLUMN "storefrontUnlocksAt" TIMESTAMP(3);
