import {
  NextRequest,
  NextResponse,
} from "next/server";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import {
  findOrCreateCustomerByEmail,
  recordCustomerEvent,
} from "@/lib/customers/identity";
import {
  allocateStockForPaidOrderAllOrNothing,
  type CartLine,
} from "@/lib/orders/stock";
import {
  consumeCheckoutReservation,
  releaseCheckoutReservationByReference,
} from "@/lib/orders/stock-reservation";
import { generateUniqueValueLike } from "@/lib/utils/slug";

export const runtime = "nodejs";

class InvalidVerifiedPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVerifiedPaymentError";
  }
}

type PaystackWebhookEvent = {
  event: string;

  data: {
    reference: string;
    amount: number;
    currency?: string;

    customer?: {
      email?: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
    };

    metadata?: {
      reservationId?: string;
      expectedAmountKobo?: number;

      cart?: {
        productId: string;
        variantId?: string;
        quantity: number;
        unitPrice?: number;
      }[];

      shippingAddress?: Record<
        string,
        unknown
      >;

      [key: string]: unknown;
    };
  };
};

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret =
    process.env.PAYSTACK_SECRET_KEY;

  if (
    !secret ||
    !signatureHeader
  ) {
    return false;
  }

  const expected =
    crypto
      .createHmac(
        "sha512",
        secret,
      )
      .update(rawBody)
      .digest("hex");

  const expectedBuffer =
    Buffer.from(expected);

  const receivedBuffer =
    Buffer.from(
      signatureHeader,
    );

  if (
    expectedBuffer.length !==
    receivedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    receivedBuffer,
  );
}

async function verifySuccessfulTransaction(
  data: PaystackWebhookEvent["data"],
): Promise<void> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const expectedAmount = data.metadata?.expectedAmountKobo;

  if (!secret || !Number.isSafeInteger(expectedAmount) || Number(expectedAmount) <= 0) {
    throw new Error("Missing server-calculated expected payment amount.");
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { status?: boolean; data?: { reference?: string; status?: string; amount?: number; currency?: string } }
    | null;
  const verified = payload?.data;
  const expected = Number(expectedAmount);

  if (
    !response.ok || payload?.status !== true || verified?.status !== "success" ||
    verified.reference !== data.reference || verified.amount !== expected ||
    data.amount !== expected || verified.currency !== "NGN" ||
    (data.currency ?? "NGN") !== "NGN"
  ) {
    throw new InvalidVerifiedPaymentError(
      "Paystack transaction verification did not match this checkout.",
    );
  }
}

type CheckoutPriceSnapshot = {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
};

function getValidatedPriceSnapshots(
  data: PaystackWebhookEvent["data"],
): CheckoutPriceSnapshot[] {
  const cart = data.metadata?.cart;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new InvalidVerifiedPaymentError("Payment metadata has no checkout cart.");
  }

  const seen = new Set<string>();
  return cart.map((line) => {
    if (
      !line || typeof line.productId !== "string" || !line.productId.trim() ||
      !(line.variantId === undefined || line.variantId === null || (typeof line.variantId === "string" && line.variantId.trim())) ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
      typeof line.unitPrice !== "number" || !Number.isFinite(line.unitPrice) || line.unitPrice < 0
    ) {
      throw new InvalidVerifiedPaymentError("Payment metadata contains an invalid cart or price snapshot.");
    }

    const variantId = line.variantId ?? null;
    const key = `${line.productId}:${variantId ?? ""}`;
    if (seen.has(key)) {
      throw new InvalidVerifiedPaymentError("Payment metadata contains duplicate product lines.");
    }
    seen.add(key);

    return {
      productId: line.productId,
      variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    };
  });
}

function normalizeCartForComparison(
  lines: Array<{ productId: string; variantId?: string | null; quantity: number }>,
): CartLine[] {
  const grouped = new Map<string, CartLine>();
  for (const line of lines) {
    if (
      typeof line.productId !== "string" || !line.productId ||
      !(line.variantId === undefined || line.variantId === null || typeof line.variantId === "string") ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0
    ) {
      throw new InvalidVerifiedPaymentError("Checkout reservation contains an invalid cart line.");
    }
    const variantId = line.variantId ?? null;
    const key = `${line.productId}:${variantId ?? ""}`;
    const current = grouped.get(key);
    if (current) current.quantity += line.quantity;
    else grouped.set(key, { productId: line.productId, variantId, quantity: line.quantity });
  }
  return Array.from(grouped.values()).sort((a, b) =>
    `${a.productId}:${a.variantId ?? ""}`.localeCompare(`${b.productId}:${b.variantId ?? ""}`),
  );
}

function readString(
  object:
    | Record<string, unknown>
    | undefined,
  key: string,
): string {
  const value =
    object?.[key];

  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

/**
 * Giftij checkout details take priority over Paystack customer profile data.
 */
function getCheckoutCustomerDetails(
  data: PaystackWebhookEvent["data"],
) {
  const shippingAddress =
    data.metadata
      ?.shippingAddress &&
    typeof data.metadata
      .shippingAddress ===
      "object"
      ? data.metadata
          .shippingAddress
      : undefined;

  const checkoutName =
    readString(
      shippingAddress,
      "fullName",
    );

  const checkoutPhone =
    readString(
      shippingAddress,
      "phone",
    );

  const country =
    readString(
      shippingAddress,
      "country",
    ) ||
    readString(
      shippingAddress,
      "countryCode",
    );

  const paystackName =
    [
      data.customer
        ?.first_name,

      data.customer
        ?.last_name,
    ]
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.trim()
            .length > 0,
      )
      .join(" ")
      .trim();

  const name =
    checkoutName ||
    paystackName ||
    data.customer
      ?.email ||
    "";

  const phone =
    checkoutPhone ||
    data.customer
      ?.phone?.trim() ||
    null;

  return {
    shippingAddress,
    name,
    phone,
    country:
      country || null,
  };
}

async function generateOrderNumber() {
  const base =
    `GB${new Date().getFullYear()}`;

  return generateUniqueValueLike(
    base,
    async (
      candidate,
    ) => {
      const existing =
        await prisma.order.findUnique(
          {
            where: {
              orderNumber:
                candidate,
            },
          },
        );

      return !!existing;
    },
  );
}

export async function POST(
  req: NextRequest,
) {
  const rawBody =
    await req.text();

  const signature =
    req.headers.get(
      "x-paystack-signature",
    );

  if (
    !verifySignature(
      rawBody,
      signature,
    )
  ) {
    return NextResponse.json(
      {
        received: false,
      },
      {
        status: 401,
      },
    );
  }

  let event:
    PaystackWebhookEvent;

  try {
    event =
      JSON.parse(
        rawBody,
      );
  } catch {
    return NextResponse.json(
      {
        received: false,
      },
      {
        status: 400,
      },
    );
  }

  try {
    if (
      event.event ===
      "charge.success"
    ) {
      await handleChargeSuccess(
        event.data,
      );
    } else if (
      event.event ===
      "charge.failed"
    ) {
      await handleChargeFailed(
        event.data,
      );
    }
  } catch (err) {
    console.error(
      "Paystack webhook processing error:",
      err,
    );

    await logActivity({
      systemSource:
        "paystack_webhook",

      action:
        "WEBHOOK_PROCESSING_ERROR",

      resource:
        `PaystackEvent:${event.event}`,

      metadata: {
        error:
          err instanceof
          Error
            ? err.message
            : String(err),

        reference:
          event.data
            ?.reference,
      },
    });

    // A verified-but-mismatched payment is not retryable. Transient failures
    // (Paystack/network/database errors) return 500 so Paystack can retry.
    if (err instanceof InvalidVerifiedPaymentError) {
      return NextResponse.json({ received: true, ignored: true }, { status: 200 });
    }

    return NextResponse.json({ received: false }, { status: 500 });
  }

  return NextResponse.json(
    {
      received: true,
    },
    {
      status: 200,
    },
  );
}

async function handleChargeSuccess(
  data: PaystackWebhookEvent["data"],
) {
  // Verify directly with Paystack before making customer, order, or stock writes.
  await verifySuccessfulTransaction(data);

  /**
   * Paystack may retry the same webhook.
   *
   * If the Order already exists for this reference, everything was already
   * processed successfully and we must not consume stock twice.
   */
  const existingOrder =
    await prisma.order.findFirst(
      {
        where: {
          paymentReference:
            data.reference,
        },
      },
    );

  if (existingOrder) {
    return;
  }

  const email =
    data.customer
      ?.email
      ?.trim()
      .toLowerCase();

  if (!email) {
    throw new Error(
      "charge.success webhook has no customer email and identity cannot be resolved.",
    );
  }

  const {
    shippingAddress,
    name,
    phone,
    country,
  } =
    getCheckoutCustomerDetails(
      data,
    );

  const customer =
    await findOrCreateCustomerByEmail(
      {
        email,
        name,
        phone,

        address:
          shippingAddress
            ? (shippingAddress as Prisma.InputJsonValue)
            : undefined,

        country:
          country ??
          undefined,
      },
    );

  const priceSnapshots = getValidatedPriceSnapshots(data);
  // For a reservation-backed checkout, the database reservation—not
  // mutable webhook metadata—is authoritative for products, variants and quantities.
  const metadataCartLines: CartLine[] = priceSnapshots.map(({ productId, variantId, quantity }) => ({
    productId, variantId, quantity,
  }));

  const products =
    await prisma.product.findMany(
      {
        where: {
          id: {
            in:
              cartLines.map(
                (line) =>
                  line.productId,
              ),
          },
        },

        select: {
          id: true,
          price: true,
          discount: true,
          costPrice: true,
        },
      },
    );

  const productById =
    new Map(
      products.map(
        (product) => [
          product.id,
          product,
        ],
      ),
    );

  let subtotal = 0;
  let costBasis = 0;

  const effectiveUnitPriceByLine = new Map<string, number>();

  // Prices must come from the server-calculated checkout snapshots. Falling
  // back to today's product price could silently change a paid order's value.
  for (const snapshot of priceSnapshots) {
    const product = productById.get(snapshot.productId);
    if (!product) {
      throw new InvalidVerifiedPaymentError(`Cart references unknown product ${snapshot.productId}`);
    }
    effectiveUnitPriceByLine.set(
      `${snapshot.productId}:${snapshot.variantId ?? ""}`,
      snapshot.unitPrice,
    );
  }

  const orderNumber =
    await generateOrderNumber();

  const order =
    await prisma.$transaction(
      async (tx) => {
        // Serialize a payment reference across all serverless instances.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${data.reference}))`;

        const duplicate = await tx.order.findFirst({
          where: { paymentReference: data.reference },
        });
        if (duplicate) {
          return { order: duplicate, usedReservation: false, alreadyProcessed: true };
        }

        /**
         * NEW RESERVATION PATH
         *
         * The checkout already removed these units from currentStock and moved
         * them into reservedStock.
         *
         * Successful payment therefore converts:
         *
         * reservedStock -> soldStock
         *
         * currentStock is NOT decremented again.
         */
        const reservationResult =
          await consumeCheckoutReservation(
            tx,
            data.reference,
          );

        const hasReservation = reservationResult.cart.length > 0;
        const cartLines = hasReservation
          ? normalizeCartForComparison(reservationResult.cart)
          : normalizeCartForComparison(metadataCartLines);

        if (hasReservation) {
          if (data.metadata?.reservationId && data.metadata.reservationId !== reservationResult.reservationId) {
            throw new InvalidVerifiedPaymentError("Payment reservation ID does not match the attached checkout reservation.");
          }
          const reservedCart = normalizeCartForComparison(reservationResult.cart);
          const metadataCart = normalizeCartForComparison(metadataCartLines);
          if (
            reservedCart.length !== metadataCart.length ||
            reservedCart.some((line, index) =>
              line.productId !== metadataCart[index]?.productId ||
              (line.variantId ?? null) !== (metadataCart[index]?.variantId ?? null) ||
              line.quantity !== metadataCart[index]?.quantity
            )
          ) {
            throw new InvalidVerifiedPaymentError("Payment cart does not match the reserved checkout cart.");
          }
        }

        for (const line of cartLines) {
          const key = `${line.productId}:${line.variantId ?? ""}`;
          if (!effectiveUnitPriceByLine.has(key)) {
            throw new InvalidVerifiedPaymentError("A reserved cart line has no matching checkout price snapshot.");
          }
          const snapshot = priceSnapshots.find((item) =>
            item.productId === line.productId && item.variantId === (line.variantId ?? null)
          );
          if (!snapshot) {
            throw new InvalidVerifiedPaymentError("A reserved cart line has no matching checkout price snapshot.");
          }
          subtotal += snapshot.unitPrice * line.quantity;
          const product = productById.get(line.productId);
          if (!product) throw new InvalidVerifiedPaymentError(`Cart references unknown product ${line.productId}`);
          costBasis += Number(product.costPrice) * line.quantity;
        }

        if (!Number.isSafeInteger(Math.round(subtotal * 100)) ||
            Math.round(subtotal * 100) !== data.amount ||
            Math.round(subtotal * 100) !== Number(data.metadata?.expectedAmountKobo)) {
          throw new InvalidVerifiedPaymentError("Checkout cart subtotal does not match the verified Paystack amount.");
        }

        /**
         * Compatibility / safety fallback.
         *
         * There may still be successful Paystack transactions created before
         * the reservation system was deployed.
         *
         * A reservation may also have expired and returned its stock before a
         * very late successful payment webhook arrives.
         *
         * In those cases we preserve the successful paid order and fall back
         * to the old atomic deduction logic.
         */
        let stockUnavailable = false;

        if (!reservationResult.consumed) {
          stockUnavailable = !(
            await allocateStockForPaidOrderAllOrNothing(
              tx,
              cartLines,
            )
          );
        }

        const created =
          await tx.order.create(
            {
              data: {
                orderNumber,

                customerId:
                  customer.id,

                status: "PENDING",
                stockUnavailable,

                shippingAddress:
                  (data.metadata
                    ?.shippingAddress ??
                    {}) as object,

                paymentReference:
                  data.reference,

                subtotal,

                profit:
                  subtotal -
                  costBasis,

                items: {
                  create:
                    cartLines.map(
                      (
                        line,
                      ) => ({
                        productId:
                          line.productId,

                        variantId:
                          line.variantId ??
                          null,

                        quantity:
                          line.quantity,

                        unitPrice:
                          effectiveUnitPriceByLine.get(
                            `${line.productId}:${line.variantId ?? ""}`,
                          )!,
                      }),
                    ),
                },

                timeline: {
                  create: {
                    label:
                      "Payment Confirmed",
                  },
                },
              },
            },
          );

        if (stockUnavailable) {
          await tx.orderNote.create({
            data: {
              orderId: created.id,
              note:
                "PAID - STOCK UNAVAILABLE: Paystack confirmed payment after the checkout reservation was no longer active. No stock was deducted. Admin resolution/refund review is required.",
              createdBy: "system:paystack_webhook",
            },
          });
        }

        return {
          order: created,
          usedReservation: reservationResult.consumed,
          alreadyProcessed: false,
        };
      },
    );

  if (order.alreadyProcessed) {
    return;
  }

  await prisma.customer.update(
    {
      where: {
        id:
          customer.id,
      },

      data: {
        lastPurchase:
          new Date(),
      },
    },
  );

  await logActivity({
    systemSource:
      "paystack_webhook",

    action:
      "ORDER_CREATED",

    resource:
      `Order:${order.order.id}`,

    metadata: {
      orderNumber,

      reference:
        data.reference,

      subtotal,

      stockSource:
        order.usedReservation
          ? "checkout_reservation"
          : "legacy_or_late_payment_fallback",
    },
  });
}

async function handleChargeFailed(
  data: PaystackWebhookEvent["data"],
) {
  /**
   * Failed payment no longer owns the reserved stock.
   *
   * Release this BEFORE doing customer CRM work. Even if customer metadata is
   * incomplete, inventory must not remain locked.
   */
  try {
    await releaseCheckoutReservationByReference(
      data.reference,
    );
  } catch (
    releaseError
  ) {
    console.error(
      "Failed to release checkout reservation after charge.failed:",
      releaseError,
    );

    await logActivity({
      systemSource:
        "paystack_webhook",

      action:
        "RESERVATION_RELEASE_ERROR",

      resource:
        `PaystackReference:${data.reference}`,

      metadata: {
        reference:
          data.reference,

        error:
          releaseError instanceof
          Error
            ? releaseError.message
            : String(
                releaseError,
              ),
      },
    });
  }

  const email =
    data.customer
      ?.email
      ?.trim()
      .toLowerCase();

  if (!email) {
    return;
  }

  const {
    shippingAddress,
    name,
    phone,
    country,
  } =
    getCheckoutCustomerDetails(
      data,
    );

  const customer =
    await findOrCreateCustomerByEmail(
      {
        email,
        name,
        phone,

        address:
          shippingAddress
            ? (shippingAddress as Prisma.InputJsonValue)
            : undefined,

        country:
          country ??
          undefined,
      },
    );

  await recordCustomerEvent(
    customer.id,
    "PAYMENT_FAILED",
    {
      reference:
        data.reference,

      amount:
        data.amount,

      currency:
        data.currency ??
        "NGN",
    },
  );

  await logActivity({
    systemSource:
      "paystack_webhook",

    action:
      "PAYMENT_FAILED",

    resource:
      `Customer:${customer.id}`,

    metadata: {
      reference:
        data.reference,
    },
  });
}