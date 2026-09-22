-- CreateEnum
CREATE TYPE "CheckoutReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CheckoutReservation" (
    "id" TEXT NOT NULL,
    "paymentReference" TEXT,
    "status" "CheckoutReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cart" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutReservation_paymentReference_key" ON "CheckoutReservation"("paymentReference");

-- CreateIndex
CREATE INDEX "CheckoutReservation_status_expiresAt_idx" ON "CheckoutReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutReservation_createdAt_idx" ON "CheckoutReservation"("createdAt");
