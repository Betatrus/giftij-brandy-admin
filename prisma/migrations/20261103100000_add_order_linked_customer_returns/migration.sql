CREATE TABLE "CustomerReturn" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "restockQuantity" INTEGER NOT NULL DEFAULT 0,
  "refundAmount" DECIMAL(12,2),
  "businessDate" DATE NOT NULL,
  "note" TEXT,
  "processedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerReturn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerReturn_orderId_idx" ON "CustomerReturn"("orderId");
CREATE INDEX "CustomerReturn_orderItemId_idx" ON "CustomerReturn"("orderItemId");
CREATE INDEX "CustomerReturn_businessDate_idx" ON "CustomerReturn"("businessDate");
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_restock_quantity_valid" CHECK ("restockQuantity" >= 0 AND "restockQuantity" <= "quantity");
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_refund_amount_nonnegative" CHECK ("refundAmount" IS NULL OR "refundAmount" >= 0);
