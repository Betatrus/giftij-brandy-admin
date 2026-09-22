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
  deductStockForOrder,
  type CartLine,
} from "@/lib/orders/stock";
import {
  consumeCheckoutReservation,
  releaseCheckoutReservationByReference,
} from "@/lib/orders/stock-reservation";
import { computeEffectivePrice } from "@/lib/pricing/effective-price";
import { generateUniqueValueLike } from "@/lib/utils/slug";

export const runtime = "nodejs";

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

      cart?: {
        productId: string;
        variantId?: string;
        quantity: number;
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

function parseCartFromMetadata(
  data: PaystackWebhookEvent["data"],
): CartLine[] {
  const cart =
    data.metadata?.cart;

  if (
    !Array.isArray(cart) ||
    cart.length === 0
  ) {
    throw new Error(
      "Webhook payload has no metadata.cart and order items cannot be reconstructed.",
    );
  }

  return cart.map(
    (line) => ({
      productId:
        line.productId,

      variantId:
        line.variantId ??
        null,

      quantity:
        line.quantity,
    }),
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

  const cartLines =
    parseCartFromMetadata(
      data,
    );

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

  const effectiveUnitPriceByLine =
    new Map<
      string,
      number
    >();

  for (
    const line of
    cartLines
  ) {
    const product =
      productById.get(
        line.productId,
      );

    if (!product) {
      throw new Error(
        `Cart references unknown product ${line.productId}`,
      );
    }

    const effectiveUnitPrice =
      computeEffectivePrice(
        Number(
          product.price,
        ),

        product.discount
          ? Number(
              product.discount,
            )
          : 0,
      );

    effectiveUnitPriceByLine.set(
      `${line.productId}:${line.variantId ?? ""}`,
      effectiveUnitPrice,
    );

    subtotal +=
      effectiveUnitPrice *
      line.quantity;

    costBasis +=
      Number(
        product.costPrice,
      ) *
      line.quantity;
  }

  const orderNumber =
    await generateOrderNumber();

  const order =
    await prisma.$transaction(
      async (tx) => {
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
        let fallbackShortfalls:
          {
            productId: string;
            variantId?:
              | string
              | null;
            requested: number;
            deducted: number;
          }[] = [];

        if (
          !reservationResult.consumed
        ) {
          const fallback =
            await deductStockForOrder(
              tx,
              cartLines,
            );

          fallbackShortfalls =
            fallback.shortfalls;
        }

        const created =
          await tx.order.create(
            {
              data: {
                orderNumber,

                customerId:
                  customer.id,

                status:
                  "PENDING",

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

        if (
          fallbackShortfalls.length >
          0
        ) {
          await tx.orderNote.create(
            {
              data: {
                orderId:
                  created.id,

                note:
                  `Stock shortfall at fulfillment: ${fallbackShortfalls
                    .map(
                      (
                        shortfall,
                      ) =>
                        `${shortfall.productId}${
                          shortfall.variantId
                            ? `/${shortfall.variantId}`
                            : ""
                        } requested ${shortfall.requested}, only ${shortfall.deducted} available`,
                    )
                    .join(
                      "; ",
                    )}`,

                createdBy:
                  "system:paystack_webhook",
              },
            },
          );
        }

        return {
          order:
            created,

          usedReservation:
            reservationResult.consumed,
        };
      },
    );

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