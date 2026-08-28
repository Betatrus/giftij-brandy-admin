import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api/api-error";

export type CartLine = { productId: string; variantId?: string | null; quantity: number };

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * Rejects an order BEFORE payment/creation if any line exceeds available
 * stock — the master prompt's "Only 7 units are currently available..."
 * / "This product is currently unavailable..." customer-facing rule.
 *
 * NOTE ON SCOPE: this function is provided for a checkout-initiation
 * endpoint (where the storefront asks "can I sell this?" before starting
 * a Paystack transaction) — but that endpoint is NOT part of this admin
 * repository as delivered, so nothing calls this function yet. It's
 * exported and ready to be wired in from wherever the storefront's
 * checkout-initiation code lives. Documented as a gap in CHANGES.md
 * Phase 2 rather than silently assumed to be handled.
 */
export async function checkStockAvailability(lines: CartLine[]): Promise<void> {
  for (const line of lines) {
    if (line.variantId) {
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: line.variantId } });
      if (variant.currentStock <= 0) {
        throw new ApiError("OUT_OF_STOCK", "This product is currently unavailable. Please contact customer support via WhatsApp for assistance.");
      }
      if (line.quantity > variant.currentStock) {
        throw new ApiError(
          "OUT_OF_STOCK",
          `Only ${variant.currentStock} units are currently available. Please contact customer support via WhatsApp for assistance.`
        );
      }
    } else {
      const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: line.productId } });
      if (inventory.currentStock <= 0) {
        throw new ApiError("OUT_OF_STOCK", "This product is currently unavailable. Please contact customer support via WhatsApp for assistance.");
      }
      if (line.quantity > inventory.currentStock) {
        throw new ApiError(
          "OUT_OF_STOCK",
          `Only ${inventory.currentStock} units are currently available. Please contact customer support via WhatsApp for assistance.`
        );
      }
    }
  }
}

/**
 * Deducts stock for a confirmed, paid order — called ONCE, inside the
 * same transaction as the Order/OrderItem creation (see the Paystack
 * webhook route), so a payment can never be recorded without its stock
 * being reserved, and vice versa.
 *
 * By the time this runs, payment has ALREADY succeeded — refusing to
 * create the order over an insufficient-stock line would leave a
 * paying customer with nothing. So unlike checkStockAvailability
 * (called pre-payment), this deducts what it can (never below 0, same
 * floor as the existing lib/actions/inventory.ts DECREASE logic) and
 * returns which lines came up short, so the caller can flag the order
 * for manual admin attention instead of silently overselling.
 */
export async function deductStockForOrder(
  tx: TxClient,
  lines: CartLine[]
): Promise<{ shortfalls: { productId: string; variantId?: string | null; requested: number; deducted: number }[] }> {
  const shortfalls: { productId: string; variantId?: string | null; requested: number; deducted: number }[] = [];

  for (const line of lines) {
    if (line.variantId) {
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: line.variantId } });
      const deducted = Math.min(line.quantity, variant.currentStock);
      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { currentStock: variant.currentStock - deducted, soldStock: variant.soldStock + deducted },
      });
      await tx.variantInventoryLog.create({
        data: {
          variantId: line.variantId,
          changeType: "DECREASE",
          quantity: deducted,
          reason: "[ONLINE_SALE] Paystack order",
        },
      });
      if (deducted < line.quantity) {
        shortfalls.push({ productId: line.productId, variantId: line.variantId, requested: line.quantity, deducted });
      }
    } else {
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId: line.productId } });
      const deducted = Math.min(line.quantity, inventory.currentStock);
      await tx.inventory.update({
        where: { productId: line.productId },
        data: { currentStock: inventory.currentStock - deducted, soldStock: inventory.soldStock + deducted },
      });
      await tx.inventoryLog.create({
        data: {
          inventoryId: inventory.id,
          changeType: "DECREASE",
          quantity: deducted,
          reason: "[ONLINE_SALE] Paystack order",
        },
      });
      if (deducted < line.quantity) {
        shortfalls.push({ productId: line.productId, variantId: null, requested: line.quantity, deducted });
      }
    }
  }

  return { shortfalls };
}
