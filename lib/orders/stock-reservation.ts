import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CartLine } from "@/lib/orders/stock";

/**
 * How long an admitted checkout owns its stock while the customer
 * completes payment.
 *
 * The reservation can be released earlier when:
 *
 * - Paystack initialization fails
 * - Paystack reports charge.failed
 *
 * Successful payment consumes the reservation.
 */
export const CHECKOUT_RESERVATION_TTL_MS =
  10 * 60 * 1000;

type TxClient =
  | Prisma.TransactionClient
  | PrismaClient;

type ReservationCartLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export class StockReservationUnavailableError extends Error {
  constructor() {
    super("Stock is not available.");
    this.name =
      "StockReservationUnavailableError";
  }
}

/**
 * Converts arbitrary checkout lines into one authoritative quantity per
 * stock unit.
 *
 * This protects us from carts that accidentally contain the same variant
 * or product more than once.
 *
 * Example:
 *
 * Black variant x2
 * Black variant x1
 *
 * becomes:
 *
 * Black variant x3
 */
function normalizeCartLines(
  lines: CartLine[],
): ReservationCartLine[] {
  const grouped =
    new Map<
      string,
      ReservationCartLine
    >();

  for (const line of lines) {
    const variantId =
      line.variantId ?? null;

    const key =
      variantId
        ? `variant:${variantId}`
        : `product:${line.productId}`;

    const existing =
      grouped.get(key);

    if (existing) {
      existing.quantity +=
        line.quantity;

      continue;
    }

    grouped.set(key, {
      productId:
        line.productId,

      variantId,

      quantity:
        line.quantity,
    });
  }

  // Stable ordering makes concurrent multi-item reservations acquire
  // inventory rows in the same order, reducing PostgreSQL deadlock risk.
  return Array.from(grouped.values()).sort((a, b) => {
    const aKey = a.variantId
      ? `variant:${a.variantId}`
      : `product:${a.productId}`;
    const bKey = b.variantId
      ? `variant:${b.variantId}`
      : `product:${b.productId}`;
    return aKey.localeCompare(bKey);
  });
}

/**
 * Reads reservation cart JSON back into the strict shape used by the
 * inventory functions.
 *
 * Reservation data is written only by our own server, but validation here
 * prevents a malformed database row from causing an unsafe stock update.
 */
function parseReservationCart(
  value: Prisma.JsonValue,
): ReservationCartLine[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "Checkout reservation contains an invalid cart.",
    );
  }

  const result:
    ReservationCartLine[] = [];

  for (const raw of value) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw)
    ) {
      throw new Error(
        "Checkout reservation contains an invalid cart line.",
      );
    }

    const productId =
      "productId" in raw
        ? raw.productId
        : undefined;

    const variantId =
      "variantId" in raw
        ? raw.variantId
        : null;

    const quantity =
      "quantity" in raw
        ? raw.quantity
        : undefined;

    if (
      typeof productId !==
        "string" ||
      productId.length === 0 ||
      !Number.isInteger(
        quantity,
      ) ||
      Number(quantity) <= 0 ||
      !(
        variantId === null ||
        typeof variantId ===
          "string"
      )
    ) {
      throw new Error(
        "Checkout reservation contains an invalid cart line.",
      );
    }

    result.push({
      productId,

      variantId:
        variantId as
          | string
          | null,

      quantity:
        Number(quantity),
    });
  }

  if (result.length === 0) {
    throw new Error(
      "Checkout reservation contains an empty cart.",
    );
  }

  return result;
}

/**
 * Atomically moves available stock into reserved stock.
 *
 * IMPORTANT:
 *
 * `currentStock` represents stock still available for another customer.
 *
 * Reserving:
 *
 * currentStock  -= quantity
 * reservedStock += quantity
 *
 * The UPDATE itself checks that enough currentStock still exists.
 *
 * Therefore 500 simultaneous requests cannot all successfully reserve the
 * same 400 units.
 *
 * PostgreSQL decides which requests win.
 */
async function reserveLine(
  tx: Prisma.TransactionClient,
  line: ReservationCartLine,
): Promise<boolean> {
  if (line.variantId) {
    const result =
      await tx.productVariant.updateMany(
        {
          where: {
            id: line.variantId,

            productId:
              line.productId,

            status:
              "ACTIVE",

            currentStock: {
              gte:
                line.quantity,
            },
          },

          data: {
            currentStock: {
              decrement:
                line.quantity,
            },

            reservedStock: {
              increment:
                line.quantity,
            },
          },
        },
      );

    return result.count === 1;
  }

  const result =
    await tx.inventory.updateMany(
      {
        where: {
          productId:
            line.productId,

          currentStock: {
            gte:
              line.quantity,
          },
        },

        data: {
          currentStock: {
            decrement:
              line.quantity,
          },

          reservedStock: {
            increment:
              line.quantity,
          },
        },
      },
    );

  return result.count === 1;
}

/**
 * Creates one all-or-nothing checkout reservation.
 *
 * If a cart contains several products/variants and even one line cannot be
 * reserved, the whole PostgreSQL transaction rolls back.
 *
 * That means we never reserve only half of a customer's cart.
 */
export async function reserveStockForCheckout(
  lines: CartLine[],
  offerCampaignId: string | null = null,
): Promise<{
  reservationId: string;
  expiresAt: Date;
}> {
  const normalized =
    normalizeCartLines(lines);

  if (normalized.length === 0) {
    throw new Error(
      "Cannot reserve an empty checkout cart.",
    );
  }

  for (const line of normalized) {
    if (
      !Number.isInteger(
        line.quantity,
      ) ||
      line.quantity <= 0
    ) {
      throw new Error(
        "Cannot reserve an invalid stock quantity.",
      );
    }
  }

  const expiresAt =
    new Date(
      Date.now() +
        CHECKOUT_RESERVATION_TTL_MS,
    );

  return prisma.$transaction(
    async (tx) => {
      /**
       * Every stock update happens inside this same transaction.
       *
       * If any line fails, throwing causes PostgreSQL to roll every previous
       * line in this reservation back automatically.
       */
      for (const line of normalized) {
        const reserved =
          await reserveLine(
            tx,
            line,
          );

        if (!reserved) {
          throw new StockReservationUnavailableError();
        }
      }

      if (offerCampaignId) {
        // One qualifying-order slot is claimed atomically with the stock reservation.
        // PostgreSQL serializes concurrent checkouts against this campaign row.
        const slotClaimed = await tx.$executeRaw`
          UPDATE "OfferCampaign"
          SET "reservedQualifyingOrders" = "reservedQualifyingOrders" + 1,
              "updatedAt" = NOW()
          WHERE "id" = ${offerCampaignId}
            AND "status" = 'PUBLISHED'
            AND ("startsAt" IS NULL OR "startsAt" <= NOW())
            AND ("endsAt" IS NULL OR "endsAt" > NOW())
            AND (
              "maxQualifyingOrders" IS NULL
              OR "qualifyingOrdersCount" + "reservedQualifyingOrders" < "maxQualifyingOrders"
            )
        `;
        if (slotClaimed !== 1) {
          throw new Error("OFFER_UNAVAILABLE: This campaign has reached its qualifying-order limit or is no longer active.");
        }
      }

      const reservation =
        await tx.checkoutReservation.create(
          {
            data: {
              status:
                "ACTIVE",

              cart:
                normalized as Prisma.InputJsonValue,

              offerCampaignId,
              expiresAt,
            },

            select: {
              id: true,
              expiresAt: true,
            },
          },
        );

      return {
        reservationId:
          reservation.id,

        expiresAt:
          reservation.expiresAt,
      };
    },
  );
}

/**
 * Connects an ACTIVE reservation with the reference returned by Paystack.
 *
 * This runs before the authorization URL is returned to the storefront.
 */
export async function attachPaymentReferenceToReservation(
  reservationId: string,
  paymentReference: string,
): Promise<void> {
  const updated =
    await prisma.checkoutReservation.updateMany(
      {
        where: {
          id: reservationId,
          status: "ACTIVE",
          paymentReference: null,
        },

        data: {
          paymentReference,
        },
      },
    );

  if (updated.count !== 1) {
    throw new Error(
      "Unable to attach Paystack reference to checkout reservation.",
    );
  }
}

/**
 * Returns reserved inventory to available inventory.
 *
 * Used when:
 *
 * - Paystack initialization fails
 * - payment fails
 * - another application-level failure happens before payment completes
 *
 * Transitioning ACTIVE -> RELEASED is atomic and idempotent.
 */
export async function releaseCheckoutReservation(
  reservationId: string,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const reservation =
        await tx.checkoutReservation.findUnique(
          {
            where: {
              id:
                reservationId,
            },

            select: {
              id: true,
              status: true,
              cart: true,
              offerCampaignId: true,
            },
          },
        );

      if (
        !reservation ||
        reservation.status !==
          "ACTIVE"
      ) {
        return false;
      }

      /**
       * Claim the state transition first.
       *
       * If another request, webhook, or expiry worker already consumed or
       * released it, this update matches zero rows.
       */
      const claimed =
        await tx.checkoutReservation.updateMany(
          {
            where: {
              id:
                reservation.id,

              status:
                "ACTIVE",
            },

            data: {
              status:
                "RELEASED",

              releasedAt:
                new Date(),
            },
          },
        );

      if (claimed.count !== 1) {
        return false;
      }

      const lines =
        parseReservationCart(
          reservation.cart,
        );

      if (reservation.offerCampaignId) {
        const slotReleased = await tx.offerCampaign.updateMany({
          where: { id: reservation.offerCampaignId, reservedQualifyingOrders: { gt: 0 } },
          data: { reservedQualifyingOrders: { decrement: 1 } },
        });
        if (slotReleased.count !== 1) throw new Error("Unable to release the reserved campaign order slot.");
      }

      for (const line of lines) {
        if (line.variantId) {
          const restored =
            await tx.productVariant.updateMany(
              {
                where: {
                  id:
                    line.variantId,

                  productId:
                    line.productId,

                  reservedStock: {
                    gte:
                      line.quantity,
                  },
                },

                data: {
                  reservedStock: {
                    decrement:
                      line.quantity,
                  },

                  currentStock: {
                    increment:
                      line.quantity,
                  },
                },
              },
            );

          if (
            restored.count !== 1
          ) {
            throw new Error(
              `Unable to release reserved stock for variant ${line.variantId}.`,
            );
          }

          continue;
        }

        const restored =
          await tx.inventory.updateMany(
            {
              where: {
                productId:
                  line.productId,

                reservedStock: {
                  gte:
                    line.quantity,
                },
              },

              data: {
                reservedStock: {
                  decrement:
                    line.quantity,
                },

                currentStock: {
                  increment:
                    line.quantity,
                },
              },
            },
          );

        if (
          restored.count !== 1
        ) {
          throw new Error(
            `Unable to release reserved stock for product ${line.productId}.`,
          );
        }
      }

      return true;
    },
  );
}

/**
 * Releases a reservation by its Paystack reference.
 *
 * charge.failed knows the reference rather than our internal reservation ID.
 */
export async function releaseCheckoutReservationByReference(
  paymentReference: string,
): Promise<boolean> {
  const reservation =
    await prisma.checkoutReservation.findUnique(
      {
        where: {
          paymentReference,
        },

        select: {
          id: true,
        },
      },
    );

  if (!reservation) {
    return false;
  }

  return releaseCheckoutReservation(
    reservation.id,
  );
}

/**
 * Converts an admitted reservation into a completed stock sale.
 *
 * IMPORTANT:
 *
 * The stock was already removed from currentStock at reservation time.
 *
 * Therefore successful payment does NOT decrement currentStock again.
 *
 * Successful payment performs:
 *
 * reservedStock -= quantity
 * soldStock     += quantity
 *
 * This function accepts an existing Prisma transaction so the Paystack
 * webhook can consume stock and create the Order atomically.
 */
export async function consumeCheckoutReservation(
  tx: Prisma.TransactionClient,
  paymentReference: string,
): Promise<{
  consumed: boolean;
  cart: ReservationCartLine[];
  reservationId: string | null;
  offerCampaignId: string | null;
}> {
  const reservation =
    await tx.checkoutReservation.findUnique(
      {
        where: {
          paymentReference,
        },

        select: {
          id: true,
          status: true,
          cart: true,
          expiresAt: true,
          offerCampaignId: true,
        },
      },
    );

  if (!reservation) {
    return {
      consumed: false,
      cart: [],
      reservationId: null,
      offerCampaignId: null,
    };
  }

  const lines =
    parseReservationCart(
      reservation.cart,
    );

  if (
    reservation.status ===
    "CONSUMED"
  ) {
    return {
      consumed: false,
      cart:
        lines,
      reservationId: reservation.id,
      offerCampaignId: reservation.offerCampaignId,
    };
  }

  if (
    reservation.status !==
    "ACTIVE"
  ) {
    return {
      consumed: false,
      cart:
        lines,
      reservationId: reservation.id,
      offerCampaignId: reservation.offerCampaignId,
    };
  }

  /**
   * Enforce the ten-minute deadline even when the scheduled/opportunistic
   * cleanup has not run yet. A late successful payment is handled by the
   * webhook's all-or-nothing paid-order allocation fallback.
   */
  if (reservation.expiresAt <= new Date()) {
    const expiredClaim = await tx.checkoutReservation.updateMany({
      where: {
        id: reservation.id,
        status: "ACTIVE",
      },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
      },
    });

    if (expiredClaim.count === 1) {
      if (reservation.offerCampaignId) {
        const slotReleased = await tx.offerCampaign.updateMany({
          where: { id: reservation.offerCampaignId, reservedQualifyingOrders: { gt: 0 } },
          data: { reservedQualifyingOrders: { decrement: 1 } },
        });
        if (slotReleased.count !== 1) throw new Error("Unable to release expired campaign order slot.");
      }
      for (const line of lines) {
        if (line.variantId) {
          const restored = await tx.productVariant.updateMany({
            where: {
              id: line.variantId,
              productId: line.productId,
              reservedStock: { gte: line.quantity },
            },
            data: {
              reservedStock: { decrement: line.quantity },
              currentStock: { increment: line.quantity },
            },
          });
          if (restored.count !== 1) {
            throw new Error(`Unable to release expired reservation for variant ${line.variantId}.`);
          }
        } else {
          const restored = await tx.inventory.updateMany({
            where: {
              productId: line.productId,
              reservedStock: { gte: line.quantity },
            },
            data: {
              reservedStock: { decrement: line.quantity },
              currentStock: { increment: line.quantity },
            },
          });
          if (restored.count !== 1) {
            throw new Error(`Unable to release expired reservation for product ${line.productId}.`);
          }
        }
      }
    }

    return {
      consumed: false,
      cart: lines,
      reservationId: reservation.id,
      offerCampaignId: reservation.offerCampaignId,
    };
  }

  const claimed =
    await tx.checkoutReservation.updateMany(
      {
        where: {
          id:
            reservation.id,

          status:
            "ACTIVE",
        },

        data: {
          status:
            "CONSUMED",

          consumedAt:
            new Date(),
        },
      },
    );

  if (claimed.count !== 1) {
    return {
      consumed: false,
      cart:
        lines,
      reservationId: reservation.id,
      offerCampaignId: reservation.offerCampaignId,
    };
  }

  if (reservation.offerCampaignId) {
    const slotConsumed = await tx.offerCampaign.updateMany({
      where: { id: reservation.offerCampaignId, reservedQualifyingOrders: { gt: 0 } },
      data: {
        reservedQualifyingOrders: { decrement: 1 },
        qualifyingOrdersCount: { increment: 1 },
      },
    });
    if (slotConsumed.count !== 1) throw new Error("Unable to consume the reserved campaign order slot.");
  }

  for (const line of lines) {
    if (line.variantId) {
      const sold =
        await tx.productVariant.updateMany(
          {
            where: {
              id:
                line.variantId,

              productId:
                line.productId,

              reservedStock: {
                gte:
                  line.quantity,
              },
            },

            data: {
              reservedStock: {
                decrement:
                  line.quantity,
              },

              soldStock: {
                increment:
                  line.quantity,
              },
            },
          },
        );

      if (sold.count !== 1) {
        throw new Error(
          `Unable to consume reserved stock for variant ${line.variantId}.`,
        );
      }

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
              "[ONLINE_SALE] Paystack reservation consumed",
          },
        },
      );

      continue;
    }

    const sold =
      await tx.inventory.updateMany(
        {
          where: {
            productId:
              line.productId,

            reservedStock: {
              gte:
                line.quantity,
            },
          },

          data: {
            reservedStock: {
              decrement:
                line.quantity,
            },

            soldStock: {
              increment:
                line.quantity,
            },
          },
        },
      );

    if (sold.count !== 1) {
      throw new Error(
        `Unable to consume reserved stock for product ${line.productId}.`,
      );
    }

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
          "[ONLINE_SALE] Paystack reservation consumed",
      },
    });
  }

  return {
    consumed: true,
    cart:
      lines,
    reservationId: reservation.id,
  };
}

/**
 * Releases ACTIVE reservations whose payment window has expired.
 *
 * This function deliberately processes a limited batch at a time so a
 * request never tries to clean thousands of records in one execution.
 *
 * It is safe to call repeatedly.
 */
export async function releaseExpiredCheckoutReservations(
  limit = 50,
): Promise<number> {
  const now =
    new Date();

  const expired =
    await prisma.checkoutReservation.findMany(
      {
        where: {
          status:
            "ACTIVE",

          expiresAt: {
            lte:
              now,
          },
        },

        orderBy: {
          expiresAt:
            "asc",
        },

        take:
          Math.max(
            1,
            Math.min(
              limit,
              100,
            ),
          ),

        select: {
          id: true,
        },
      },
    );

  let released = 0;

  for (const item of expired) {
    const didRelease =
      await expireCheckoutReservation(
        item.id,
        now,
      );

    if (didRelease) {
      released += 1;
    }
  }

  return released;
}

/**
 * Internal expiry transition.
 *
 * ACTIVE -> EXPIRED
 *
 * reserved stock is returned to currentStock.
 */
async function expireCheckoutReservation(
  reservationId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const reservation =
        await tx.checkoutReservation.findUnique(
          {
            where: {
              id:
                reservationId,
            },

            select: {
              id: true,
              status: true,
              expiresAt: true,
              cart: true,
              offerCampaignId: true,
            },
          },
        );

      if (
        !reservation ||
        reservation.status !==
          "ACTIVE" ||
        reservation.expiresAt >
          now
      ) {
        return false;
      }

      const claimed =
        await tx.checkoutReservation.updateMany(
          {
            where: {
              id:
                reservation.id,

              status:
                "ACTIVE",

              expiresAt: {
                lte:
                  now,
              },
            },

            data: {
              status:
                "EXPIRED",

              releasedAt:
                now,
            },
          },
        );

      if (claimed.count !== 1) {
        return false;
      }

      if (reservation.offerCampaignId) {
        const slotReleased = await tx.offerCampaign.updateMany({
          where: { id: reservation.offerCampaignId, reservedQualifyingOrders: { gt: 0 } },
          data: { reservedQualifyingOrders: { decrement: 1 } },
        });
        if (slotReleased.count !== 1) throw new Error("Unable to release expired campaign order slot.");
      }

      const lines =
        parseReservationCart(
          reservation.cart,
        );

      for (const line of lines) {
        if (line.variantId) {
          const restored =
            await tx.productVariant.updateMany(
              {
                where: {
                  id:
                    line.variantId,

                  productId:
                    line.productId,

                  reservedStock: {
                    gte:
                      line.quantity,
                  },
                },

                data: {
                  reservedStock: {
                    decrement:
                      line.quantity,
                  },

                  currentStock: {
                    increment:
                      line.quantity,
                  },
                },
              },
            );

          if (
            restored.count !== 1
          ) {
            throw new Error(
              `Unable to expire reserved stock for variant ${line.variantId}.`,
            );
          }

          continue;
        }

        const restored =
          await tx.inventory.updateMany(
            {
              where: {
                productId:
                  line.productId,

                reservedStock: {
                  gte:
                    line.quantity,
                },
              },

              data: {
                reservedStock: {
                  decrement:
                    line.quantity,
                },

                currentStock: {
                  increment:
                    line.quantity,
                },
              },
            },
          );

        if (
          restored.count !== 1
        ) {
          throw new Error(
            `Unable to expire reserved stock for product ${line.productId}.`,
          );
        }
      }

      return true;
    },
  );
}