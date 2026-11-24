CREATE TYPE "EmailEventType" AS ENUM (
  'CHECKOUT_EXPIRED',
  'PAYMENT_FAILED',
  'ORDER_CONFIRMED',
  'ORDER_PROCESSING',
  'ORDER_COMPLETED',
  'ORDER_CANCELLED',
  'ORDER_REFUNDED'
);

CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

ALTER TABLE "CheckoutReservation"
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "customerName" TEXT;

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" "EmailEventType" NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientName" TEXT,
  "payload" JSONB NOT NULL,
  "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_eventKey_key" ON "EmailOutbox"("eventKey");
CREATE INDEX "EmailOutbox_status_availableAt_createdAt_idx" ON "EmailOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "EmailOutbox_status_lockedAt_idx" ON "EmailOutbox"("status", "lockedAt");
