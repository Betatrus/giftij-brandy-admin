import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CartLine = {
  productId: string;
  variantId?: string | null;
  quantity: number;
};

type TxClient =
  | Prisma.TransactionClient
  | PrismaClient;

/**
 * Checkout already resolves the product name before stock is checked.
 */
export type StockCheckLine =
  CartLine & {
    name?: string;
  };

export interface UnavailableStockLine {
  productId: string;
  variantId?: string | null;

  /**
   * Human readable product + variant description.
   *
   * Examples:
   * Pedro Slippers Black 42
   * Classic Bag Red
   */
  name: string;

  requested: number;
  available: number;

  reason:
    | "OUT_OF_STOCK"
    | "INSUFFICIENT_STOCK";
}

/**
 * Checks every requested cart line against the current live inventory.
 *
 * This runs BEFORE Paystack initialization.
 *
 * It does not reserve stock. Its purpose is to prevent an obviously
 * unavailable cart from being sent to Paystack.
 *
 * Final authoritative deduction happens after successful payment through
 * deductStockForOrder().
 */
export async function checkStockAvailability(
  lines: StockCheckLine[],
): Promise<
  UnavailableStockLine[]
> {
  const unavailable: UnavailableStockLine[] =
    [];

  for (const line of lines) {
    if (line.variantId) {
      const variant =
        await prisma.productVariant.findUniqueOrThrow(
          {
            where: {
              id: line.variantId,
            },

            select: {
              id: true,
              currentStock: true,
              color: true,
              size: true,
              value: true,
            },
          },
        );

      if (
        line.quantity >
        variant.currentStock
      ) {
        const variantLabel =
          [
            variant.color,
            variant.size,
          ]
            .filter(Boolean)
            .join(" ") ||
          variant.value ||
          "";

        const displayName = [
          line.name,
          variantLabel,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        unavailable.push({
          productId: line.productId,
          variantId: line.variantId,
          name:
            displayName ||
            "Selected product",
          requested:
            line.quantity,
          available:
            variant.currentStock,
          reason:
            variant.currentStock <= 0
              ? "OUT_OF_STOCK"
              : "INSUFFICIENT_STOCK",
        });
      }

      continue;
    }

    const inventory =
      await prisma.inventory.findUniqueOrThrow(
        {
          where: {
            productId:
              line.productId,
          },

          select: {
            id: true,
            currentStock: true,
          },
        },
      );

    if (
      line.quantity >
      inventory.currentStock
    ) {
      unavailable.push({
        productId: line.productId,
        variantId: null,
        name:
          line.name?.trim() ||
          "Selected product",
        requested:
          line.quantity,
        available:
          inventory.currentStock,
        reason:
          inventory.currentStock <= 0
            ? "OUT_OF_STOCK"
            : "INSUFFICIENT_STOCK",
      });
    }
  }

  return unavailable;
}

type StockShortfall = {
  productId: string;
  variantId?: string | null;
  requested: number;
  deducted: number;
};

/**
 * Attempts to deduct a complete quantity from one ProductVariant using
 * one atomic database UPDATE.
 *
 * The WHERE clause only matches if enough stock still exists at the exact
 * moment PostgreSQL executes the update.
 *
 * This prevents two concurrent paid orders from both reading the same
 * currentStock and then overwriting one another.
 */
async function tryFullVariantDeduction(
  tx: TxClient,
  variantId: string,
  quantity: number,
) {
  return tx.productVariant.updateMany(
    {
      where: {
        id: variantId,

        currentStock: {
          gte: quantity,
        },
      },

      data: {
        currentStock: {
          decrement: quantity,
        },

        soldStock: {
          increment: quantity,
        },
      },
    },
  );
}

/**
 * Same atomic full-quantity deduction for non-variant inventory.
 */
async function tryFullInventoryDeduction(
  tx: TxClient,
  productId: string,
  quantity: number,
) {
  return tx.inventory.updateMany({
    where: {
      productId,

      currentStock: {
        gte: quantity,
      },
    },

    data: {
      currentStock: {
        decrement: quantity,
      },

      soldStock: {
        increment: quantity,
      },
    },
  });
}

/**
 * A rare race can occur after the pre-payment stock check:
 *
 * Customer A checks stock
 * Customer B checks stock
 * both see the final units
 * both successfully pay
 *
 * The first paid order gets the full atomic deduction.
 *
 * For the second paid order, we preserve the successful Order and deduct
 * whatever stock is still available without ever allowing inventory to go
 * negative.
 *
 * This uses compare-and-swap:
 *
 * read current stock
 * update only if currentStock still equals that exact value
 *
 * If another transaction changed the value first, retry.
 */
async function deductRemainingVariantStock(
  tx: TxClient,
  variantId: string,
  requested: number,
): Promise<number> {
  for (
    let attempt = 0;
    attempt < 5;
    attempt += 1
  ) {
    const variant =
      await tx.productVariant.findUniqueOrThrow(
        {
          where: {
            id: variantId,
          },

          select: {
            currentStock: true,
          },
        },
      );

    if (
      variant.currentStock <= 0
    ) {
      return 0;
    }

    const quantityToDeduct =
      Math.min(
        requested,
        variant.currentStock,
      );

    const updated =
      await tx.productVariant.updateMany(
        {
          where: {
            id: variantId,

            /**
             * Compare-and-swap guard.
             *
             * The update succeeds only if stock has not changed since the
             * read immediately above.
             */
            currentStock:
              variant.currentStock,
          },

          data: {
            currentStock: {
              decrement:
                quantityToDeduct,
            },

            soldStock: {
              increment:
                quantityToDeduct,
            },
          },
        },
      );

    if (updated.count === 1) {
      return quantityToDeduct;
    }
  }

  /**
   * Another transaction continuously won the race.
   *
   * We deliberately return zero rather than risk an unsafe write.
   * The paid order is preserved and the shortfall is surfaced to Admin.
   */
  return 0;
}

async function deductRemainingInventoryStock(
  tx: TxClient,
  productId: string,
  requested: number,
): Promise<number> {
  for (
    let attempt = 0;
    attempt < 5;
    attempt += 1
  ) {
    const inventory =
      await tx.inventory.findUniqueOrThrow(
        {
          where: {
            productId,
          },

          select: {
            currentStock: true,
          },
        },
      );

    if (
      inventory.currentStock <= 0
    ) {
      return 0;
    }

    const quantityToDeduct =
      Math.min(
        requested,
        inventory.currentStock,
      );

    const updated =
      await tx.inventory.updateMany(
        {
          where: {
            productId,

            currentStock:
              inventory.currentStock,
          },

          data: {
            currentStock: {
              decrement:
                quantityToDeduct,
            },

            soldStock: {
              increment:
                quantityToDeduct,
            },
          },
        },
      );

    if (updated.count === 1) {
      return quantityToDeduct;
    }
  }

  return 0;
}

/**
 * All-or-nothing stock allocation for a successfully paid checkout whose
 * temporary reservation has already expired. If any line is unavailable,
 * earlier line updates are reversed inside the same transaction, so no
 * partial quantity is ever consumed.
 */
export async function allocateStockForPaidOrderAllOrNothing(
  tx: TxClient,
  lines: CartLine[],
): Promise<boolean> {
  const applied: CartLine[] = [];

  for (const line of lines) {
    const result = line.variantId
      ? await tryFullVariantDeduction(tx, line.variantId, line.quantity)
      : await tryFullInventoryDeduction(tx, line.productId, line.quantity);

    if (result.count !== 1) {
      // The transaction still holds the row locks from successful updates.
      // Reverse those exact updates before allowing the caller to commit.
      for (const previous of applied.reverse()) {
        if (previous.variantId) {
          const restored = await tx.productVariant.updateMany({
            where: {
              id: previous.variantId,
              soldStock: { gte: previous.quantity },
            },
            data: {
              currentStock: { increment: previous.quantity },
              soldStock: { decrement: previous.quantity },
            },
          });
          if (restored.count !== 1) {
            throw new Error("Could not reverse a partial variant allocation.");
          }
        } else {
          const restored = await tx.inventory.updateMany({
            where: {
              productId: previous.productId,
              soldStock: { gte: previous.quantity },
            },
            data: {
              currentStock: { increment: previous.quantity },
              soldStock: { decrement: previous.quantity },
            },
          });
          if (restored.count !== 1) {
            throw new Error("Could not reverse a partial inventory allocation.");
          }
        }
      }
      return false;
    }

    applied.push(line);
  }

  // Write movement logs only after every line has been allocated.
  for (const line of applied) {
    if (line.variantId) {
      await tx.variantInventoryLog.create({
        data: {
          variantId: line.variantId,
          changeType: "DECREASE",
          quantity: line.quantity,
          reason: "[ONLINE_SALE] Late Paystack payment allocation",
        },
      });
    } else {
      const inventory = await tx.inventory.findUniqueOrThrow({
        where: { productId: line.productId },
        select: { id: true },
      });
      await tx.inventoryLog.create({
        data: {
          inventoryId: inventory.id,
          changeType: "DECREASE",
          quantity: line.quantity,
          reason: "[ONLINE_SALE] Late Paystack payment allocation",
        },
      });
    }
  }

  return true;
}

/**
 * Final authoritative stock deduction for a successfully paid order.
 *
 * IMPORTANT:
 *
 * Payment has already succeeded when this runs.
 *
 * Therefore a stock race must NEVER make us throw away the paid order.
 *
 * Instead:
 *
 * enough stock
 * -> deduct everything atomically
 *
 * insufficient stock after payment
 * -> deduct only what remains
 * -> never go below zero
 * -> return a shortfall
 * -> webhook keeps the Order and creates an Admin note
 */
export async function deductStockForOrder(
  tx: TxClient,
  lines: CartLine[],
): Promise<{
  shortfalls: StockShortfall[];
}> {
  const shortfalls: StockShortfall[] =
    [];

  for (const line of lines) {
    if (line.variantId) {
      /**
       * Fast path.
       *
       * In normal checkout this is what should happen almost every time.
       */
      const fullDeduction =
        await tryFullVariantDeduction(
          tx,
          line.variantId,
          line.quantity,
        );

      if (
        fullDeduction.count === 1
      ) {
        await tx.variantInventoryLog.create(
          {
            data: {
              variantId:
                line.variantId,
              changeType:
                "DECREASE",
              quantity:
                line.quantity,
              reason:
                "[ONLINE_SALE] Paystack order",
            },
          },
        );

        continue;
      }

      /**
       * Rare paid-order race.
       */
      const deducted =
        await deductRemainingVariantStock(
          tx,
          line.variantId,
          line.quantity,
        );

      if (deducted > 0) {
        await tx.variantInventoryLog.create(
          {
            data: {
              variantId:
                line.variantId,
              changeType:
                "DECREASE",
              quantity:
                deducted,
              reason:
                "[ONLINE_SALE] Paystack order - partial stock after concurrent checkout",
            },
          },
        );
      }

      shortfalls.push({
        productId:
          line.productId,
        variantId:
          line.variantId,
        requested:
          line.quantity,
        deducted,
      });

      continue;
    }

    /**
     * Non-variant product.
     */
    const fullDeduction =
      await tryFullInventoryDeduction(
        tx,
        line.productId,
        line.quantity,
      );

    if (
      fullDeduction.count === 1
    ) {
      const inventory =
        await tx.inventory.findUniqueOrThrow(
          {
            where: {
              productId:
                line.productId,
            },

            select: {
              id: true,
            },
          },
        );

      await tx.inventoryLog.create({
        data: {
          inventoryId:
            inventory.id,
          changeType:
            "DECREASE",
          quantity:
            line.quantity,
          reason:
            "[ONLINE_SALE] Paystack order",
        },
      });

      continue;
    }

    /**
     * Rare paid-order race.
     */
    const deducted =
      await deductRemainingInventoryStock(
        tx,
        line.productId,
        line.quantity,
      );

    const inventory =
      await tx.inventory.findUniqueOrThrow(
        {
          where: {
            productId:
              line.productId,
          },

          select: {
            id: true,
          },
        },
      );

    if (deducted > 0) {
      await tx.inventoryLog.create({
        data: {
          inventoryId:
            inventory.id,
          changeType:
            "DECREASE",
          quantity:
            deducted,
          reason:
            "[ONLINE_SALE] Paystack order - partial stock after concurrent checkout",
        },
      });
    }

    shortfalls.push({
      productId:
        line.productId,
      variantId: null,
      requested:
        line.quantity,
      deducted,
    });
  }

  return {
    shortfalls,
  };
}