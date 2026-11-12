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
  findOrCreateCustomerByEmailInTransaction,
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

export const runtime = "nodejs";

class PaymentVerificationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentVerificationMismatchError";
  }
}

class PaymentReviewRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentReviewRequiredError";
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

  if (!secret) {
    throw new Error("Paystack verification is not configured.");
  }

  // Verify the provider record first. Missing or malformed checkout metadata
  // must not cause a verified successful payment to retry forever.
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

  if (
    !response.ok || payload?.status !== true || verified?.status !== "success" ||
    verified.reference !== data.reference ||
    !Number.isSafeInteger(verified.amount) || verified.amount !== data.amount ||
    verified.currency !== "NGN" || (data.currency ?? "NGN") !== "NGN"
  ) {
    throw new PaymentVerificationMismatchError(
      "Paystack transaction verification did not match this checkout.",
    );
  }

  const expectedAmount = data.metadata?.expectedAmountKobo;
  if (
    !Number.isSafeInteger(expectedAmount) ||
    Number(expectedAmount) <= 0
  ) {
    throw new PaymentReviewRequiredError(
      "Paystack verified the payment, but the server-calculated checkout amount is missing or invalid.",
    );
  }

  // Paystack's customer-pays-fees setting can make the amount charged
  // higher than Giftij's server-calculated product subtotal. The checkout
  // amount remains the lower bound; the extra provider fee is not revenue
  // and must never be added to the order's product subtotal.
  if (verified.amount < Number(expectedAmount)) {
    throw new PaymentReviewRequiredError(
      "Paystack confirmed a payment below the server-calculated checkout amount.",
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
    throw new PaymentReviewRequiredError("Payment metadata has no checkout cart.");
  }

  const grouped = new Map<string, CheckoutPriceSnapshot>();

  for (const line of cart) {
    if (
      !line || typeof line.productId !== "string" || !line.productId.trim() ||
      !(line.variantId === undefined || line.variantId === null || (typeof line.variantId === "string" && line.variantId.trim())) ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
      typeof line.unitPrice !== "number" || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 ||
      !Number.isSafeInteger(Math.round(line.unitPrice * 100)) ||
      Math.abs(line.unitPrice * 100 - Math.round(line.unitPrice * 100)) > 1e-7
    ) {
      throw new PaymentReviewRequiredError("Payment metadata contains an invalid cart or price snapshot.");
    }

    const variantId = line.variantId ?? null;
    const key = `${line.productId}:${variantId ?? ""}`;
    const existing = grouped.get(key);

    if (existing) {
      // Duplicate product/variant rows are safe to combine only when they
      // carry the same immutable unit-price snapshot.
      if (existing.unitPrice !== line.unitPrice) {
        throw new PaymentReviewRequiredError("Duplicate cart lines contain conflicting price snapshots.");
      }
      const combinedQuantity = existing.quantity + line.quantity;
      if (!Number.isSafeInteger(combinedQuantity)) {
        throw new PaymentReviewRequiredError("Payment metadata contains an invalid cart quantity.");
      }
      existing.quantity = combinedQuantity;
    } else {
      grouped.set(key, {
        productId: line.productId,
        variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      });
    }
  }

  return Array.from(grouped.values());
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
      throw new PaymentReviewRequiredError("Checkout reservation contains an invalid cart line.");
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
    [
      readString(shippingAddress, "firstName"),
      readString(shippingAddress, "lastName"),
    ].filter(Boolean).join(" ").trim() ||
    readString(shippingAddress, "fullName");

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

async function generateOrderNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  // Giftij Brandy order numbers use the Lagos business calendar year.
  const year = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Africa/Lagos",
      year: "numeric",
    }).format(new Date()),
  );

  // The INSERT ... ON CONFLICT update serializes concurrent allocations
  // for the same year across all server instances. This runs inside the
  // order-creation transaction, so a failed order creation rolls back
  // the counter increment as well.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO "OrderNumberCounter" ("year", "lastValue")
      VALUES (${year}, 1)
      ON CONFLICT ("year")
      DO UPDATE SET "lastValue" = "OrderNumberCounter"."lastValue" + 1
      RETURNING "lastValue"
    `;

    const lastValue = Number(rows[0]?.lastValue);
    if (!Number.isSafeInteger(lastValue) || lastValue < 1) {
      throw new Error("Unable to allocate the yearly order number.");
    }

    const candidate = `GB-${year}-${String(lastValue).padStart(4, "0")}`;
    const existing = await tx.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;
  }

  throw new Error("Unable to allocate a unique order number after 100 attempts.");
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

    // A Paystack-verified charge with invalid checkout metadata is persisted
    // as a minimal review case. No customer details, amounts, or raw payloads
    // are copied into the admin review queue.
    if (err instanceof PaymentReviewRequiredError) {
      const resource = `PaystackReference:${event.data.reference}`;

      // Serialize review creation per reference across serverless instances.
      // The lock + existence check + insert share one transaction, so
      // concurrent Paystack redeliveries cannot create duplicate review rows.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${resource}))::text AS lock_result`;
        const existingReview = await tx.activityLog.findFirst({
          where: {
            action: "PAYMENT_REVIEW_REQUIRED",
            resource,
          },
          select: { id: true },
        });

        if (!existingReview) {
          await tx.activityLog.create({
            data: {
              systemSource: "paystack_webhook",
              action: "PAYMENT_REVIEW_REQUIRED",
              resource,
              metadata: {
                reference: event.data.reference,
                reason: err.message,
                verificationState: "PAYSTACK_VERIFIED",
              },
            },
          });
        }
      });
      return NextResponse.json({ received: true, reviewRequired: true }, { status: 200 });
    }

    if (err instanceof PaymentVerificationMismatchError) {
      await logActivity({
        systemSource: "paystack_webhook",
        action: "PAYMENT_VERIFICATION_REJECTED",
        resource: `PaystackReference:${event.data.reference}`,
        metadata: {
          reference: event.data.reference,
          verificationState: "NOT_VERIFIED",
        },
      });
      return NextResponse.json({ received: true, ignored: true }, { status: 200 });
    }

    await logActivity({
      systemSource: "paystack_webhook",
      action: "WEBHOOK_PROCESSING_ERROR",
      resource: `PaystackEvent:${event.event}`,
      metadata: {
        error: err instanceof Error ? err.message : String(err),
        reference: event.data?.reference,
      },
    });

    // Transient Paystack/network/database failures remain retryable.
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
    throw new PaymentReviewRequiredError(
      "Verified payment has no customer email; customer identity cannot be safely resolved.",
    );
  }

  // Reject malformed or incomplete payment metadata before any customer,
  // order, or inventory writes. A verified charge with an invalid cart must
  // not create a partial customer record as a side effect.
  const priceSnapshots = getValidatedPriceSnapshots(data);
  const snapshotSubtotal = priceSnapshots.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const snapshotAmountKobo = Math.round(snapshotSubtotal * 100);
  if (
    !Number.isSafeInteger(snapshotAmountKobo) ||
    snapshotAmountKobo !== Number(data.metadata?.expectedAmountKobo) ||
    data.amount < snapshotAmountKobo
  ) {
    throw new PaymentReviewRequiredError("Checkout product subtotal does not match the server-calculated checkout amount or the verified payment is insufficient.");
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

  // Customer creation/profile updates are deferred until all reservation,
  // cart and price checks pass, then committed atomically with the order.
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
              metadataCartLines.map(
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
      throw new PaymentReviewRequiredError(`Cart references unknown product ${snapshot.productId}`);
    }
    effectiveUnitPriceByLine.set(
      `${snapshot.productId}:${snapshot.variantId ?? ""}`,
      snapshot.unitPrice,
    );
  }

  const order =
    await prisma.$transaction(
      async (tx) => {
        // Serialize a payment reference across all serverless instances.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${data.reference}))::text AS lock_result`;

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
        let offerSlotExpired = false;
        if (reservationResult.offerCampaignId && !reservationResult.consumed) {
          // A payment can arrive after the ten-minute reservation expiry. Recount it
          // only if the campaign still has a qualifying-order slot; otherwise flag it
          // for admin review instead of silently exceeding the configured limit.
          const lateSlotClaim = await tx.$executeRaw`
            UPDATE "OfferCampaign"
            SET "qualifyingOrdersCount" = "qualifyingOrdersCount" + 1,
                "updatedAt" = NOW()
            WHERE "id" = ${reservationResult.offerCampaignId}
              AND (
                "maxQualifyingOrders" IS NULL
                OR "qualifyingOrdersCount" + "reservedQualifyingOrders" < "maxQualifyingOrders"
              )
          `;
          offerSlotExpired = lateSlotClaim !== 1;
        }
        const cartLines = hasReservation
          ? normalizeCartForComparison(reservationResult.cart)
          : normalizeCartForComparison(metadataCartLines);

        if (hasReservation) {
          if (data.metadata?.reservationId !== reservationResult.reservationId) {
            throw new PaymentReviewRequiredError("Payment reservation ID does not match the attached checkout reservation.");
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
            throw new PaymentReviewRequiredError("Payment cart does not match the reserved checkout cart.");
          }
        }

        for (const line of cartLines) {
          const key = `${line.productId}:${line.variantId ?? ""}`;
          if (!effectiveUnitPriceByLine.has(key)) {
            throw new PaymentReviewRequiredError("A reserved cart line has no matching checkout price snapshot.");
          }
          const snapshot = priceSnapshots.find((item) =>
            item.productId === line.productId && item.variantId === (line.variantId ?? null)
          );
          if (!snapshot) {
            throw new PaymentReviewRequiredError("A reserved cart line has no matching checkout price snapshot.");
          }
          subtotal += snapshot.unitPrice * line.quantity;
          const product = productById.get(line.productId);
          if (!product) throw new PaymentReviewRequiredError(`Cart references unknown product ${line.productId}`);
          costBasis += Number(product.costPrice) * line.quantity;
        }

        if (!Number.isSafeInteger(Math.round(subtotal * 100)) ||
            Math.round(subtotal * 100) !== Number(data.metadata?.expectedAmountKobo) ||
            data.amount < Math.round(subtotal * 100)) {
          throw new PaymentReviewRequiredError("Checkout product subtotal does not match the server-calculated checkout amount or the verified payment is insufficient.");
        }

        const customer = await findOrCreateCustomerByEmailInTransaction(
          tx,
          {
            email,
            name,
            phone,
            address: shippingAddress
              ? (shippingAddress as Prisma.InputJsonValue)
              : undefined,
            country: country ?? undefined,
          },
        );

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

        const orderNumber = await generateOrderNumber(tx);

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

        if (offerSlotExpired) {
          await tx.orderNote.create({
            data: {
              orderId: created.id,
              note: "PAID - OFFER RESERVATION EXPIRED: Paystack confirmed payment after the campaign checkout slot expired or was released. Review the campaign qualifying-order limit and this order before fulfilment.",
              createdBy: "system:paystack_webhook",
            },
          });
        }

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

        await tx.customer.update({
          where: { id: customer.id },
          data: { lastPurchase: new Date() },
        });

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

  await logActivity({
    systemSource:
      "paystack_webhook",

    action:
      "ORDER_CREATED",

    resource:
      `Order:${order.order.id}`,

    metadata: {
      orderNumber: order.order.orderNumber,

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