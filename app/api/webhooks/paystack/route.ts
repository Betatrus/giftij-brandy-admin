import { NextRequest, NextResponse } from "next/server";
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
      cart?: {
        productId: string;
        variantId?: string;
        quantity: number;
      }[];

      shippingAddress?: Record<string, unknown>;

      [key: string]: unknown;
    };
  };
};

function verifySignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret || !signatureHeader) {
    return false;
  }

  const expected = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function parseCartFromMetadata(
  data: PaystackWebhookEvent["data"]
): CartLine[] {
  const cart = data.metadata?.cart;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error(
      "Webhook payload has no metadata.cart and order items cannot be reconstructed."
    );
  }

  return cart.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: line.quantity,
  }));
}

function readString(
  object: Record<string, unknown> | undefined,
  key: string
): string {
  const value = object?.[key];

  return typeof value === "string"
    ? value.trim()
    : "";
}

/**
 * Customer delivery/contact information should come primarily from the
 * Giftij checkout form.
 *
 * Paystack customer information is only used as a fallback because
 * Paystack does not necessarily return the full name/phone entered on
 * Giftij's own checkout page.
 */
function getCheckoutCustomerDetails(
  data: PaystackWebhookEvent["data"]
) {
  const shippingAddress =
    data.metadata?.shippingAddress &&
    typeof data.metadata.shippingAddress === "object"
      ? data.metadata.shippingAddress
      : undefined;

  const checkoutName = readString(
    shippingAddress,
    "fullName"
  );

  const checkoutPhone = readString(
    shippingAddress,
    "phone"
  );

  const country =
    readString(shippingAddress, "country") ||
    readString(shippingAddress, "countryCode");

  const paystackName = [
    data.customer?.first_name,
    data.customer?.last_name,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.trim().length > 0
    )
    .join(" ")
    .trim();

  const name =
    checkoutName ||
    paystackName ||
    data.customer?.email ||
    "";

  const phone =
    checkoutPhone ||
    data.customer?.phone?.trim() ||
    null;

  return {
    shippingAddress,
    name,
    phone,
    country: country || null,
  };
}

async function generateOrderNumber() {
  const base = `GB${new Date().getFullYear()}`;

  return generateUniqueValueLike(
    base,
    async (candidate) => {
      const existing =
        await prisma.order.findUnique({
          where: {
            orderNumber: candidate,
          },
        });

      return !!existing;
    }
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signature = req.headers.get(
    "x-paystack-signature"
  );

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json(
      {
        received: false,
      },
      {
        status: 401,
      }
    );
  }

  let event: PaystackWebhookEvent;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      {
        received: false,
      },
      {
        status: 400,
      }
    );
  }

  try {
    if (event.event === "charge.success") {
      await handleChargeSuccess(event.data);
    } else if (event.event === "charge.failed") {
      await handleChargeFailed(event.data);
    }
  } catch (err) {
    console.error(
      "Paystack webhook processing error:",
      err
    );

    await logActivity({
      systemSource: "paystack_webhook",
      action: "WEBHOOK_PROCESSING_ERROR",
      resource: `PaystackEvent:${event.event}`,
      metadata: {
        error:
          err instanceof Error
            ? err.message
            : String(err),
        reference: event.data?.reference,
      },
    });
  }

  return NextResponse.json(
    {
      received: true,
    },
    {
      status: 200,
    }
  );
}

async function handleChargeSuccess(
  data: PaystackWebhookEvent["data"]
) {
  /**
   * Duplicate webhook protection.
   *
   * Paystack may retry webhook deliveries, so an already-created order
   * must never be created again.
   */
  const existingOrder =
    await prisma.order.findFirst({
      where: {
        paymentReference: data.reference,
      },
    });

  if (existingOrder) {
    return;
  }

  const email = data.customer?.email
    ?.trim()
    .toLowerCase();

  if (!email) {
    throw new Error(
      "charge.success webhook has no customer email and identity cannot be resolved."
    );
  }

  /**
   * Giftij checkout information takes priority over Paystack's customer
   * profile information.
   */
  const {
    shippingAddress,
    name,
    phone,
    country,
  } = getCheckoutCustomerDetails(data);

  const customer =
    await findOrCreateCustomerByEmail({
      email,
      name,
      phone,

      address: shippingAddress
        ? (shippingAddress as Prisma.InputJsonValue)
        : undefined,

      country: country ?? undefined,
    });

  const cartLines =
    parseCartFromMetadata(data);

  const products =
    await prisma.product.findMany({
      where: {
        id: {
          in: cartLines.map(
            (line) => line.productId
          ),
        },
      },

      select: {
        id: true,
        price: true,
        discount: true,
        costPrice: true,
      },
    });

  const productById = new Map(
    products.map((product) => [
      product.id,
      product,
    ])
  );

  let subtotal = 0;
  let costBasis = 0;

  const effectiveUnitPriceByLine =
    new Map<string, number>();

  for (const line of cartLines) {
    const product =
      productById.get(line.productId);

    if (!product) {
      throw new Error(
        `Cart references unknown product ${line.productId}`
      );
    }

    const effectiveUnitPrice =
      computeEffectivePrice(
        Number(product.price),
        product.discount
          ? Number(product.discount)
          : 0
      );

    effectiveUnitPriceByLine.set(
      `${line.productId}:${line.variantId ?? ""}`,
      effectiveUnitPrice
    );

    subtotal +=
      effectiveUnitPrice *
      line.quantity;

    costBasis +=
      Number(product.costPrice) *
      line.quantity;
  }

  const orderNumber =
    await generateOrderNumber();

  const order =
    await prisma.$transaction(
      async (tx) => {
        const created =
          await tx.order.create({
            data: {
              orderNumber,

              customerId:
                customer.id,

              status: "PENDING",

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
                    (line) => ({
                      productId:
                        line.productId,

                      variantId:
                        line.variantId ??
                        null,

                      quantity:
                        line.quantity,

                      unitPrice:
                        effectiveUnitPriceByLine.get(
                          `${line.productId}:${line.variantId ?? ""}`
                        )!,
                    })
                  ),
              },

              timeline: {
                create: {
                  label:
                    "Payment Confirmed",
                },
              },
            },
          });

        /**
         * Final authoritative inventory deduction.
         *
         * This happens after successful payment and inside the order
         * transaction.
         */
        const { shortfalls } =
          await deductStockForOrder(
            tx,
            cartLines
          );

        if (
          shortfalls.length > 0
        ) {
          await tx.orderNote.create({
            data: {
              orderId:
                created.id,

              note:
                `Stock shortfall at fulfillment: ${shortfalls
                  .map(
                    (shortfall) =>
                      `${shortfall.productId}${
                        shortfall.variantId
                          ? `/${shortfall.variantId}`
                          : ""
                      } requested ${shortfall.requested}, only ${shortfall.deducted} available`
                  )
                  .join("; ")}`,

              createdBy:
                "system:paystack_webhook",
            },
          });
        }

        return created;
      }
    );

  await prisma.customer.update({
    where: {
      id: customer.id,
    },

    data: {
      lastPurchase: new Date(),
    },
  });

  await logActivity({
    systemSource:
      "paystack_webhook",

    action:
      "ORDER_CREATED",

    resource:
      `Order:${order.id}`,

    metadata: {
      orderNumber,
      reference:
        data.reference,
      subtotal,
    },
  });
}

async function handleChargeFailed(
  data: PaystackWebhookEvent["data"]
) {
  const email = data.customer?.email
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
  } = getCheckoutCustomerDetails(data);

  const customer =
    await findOrCreateCustomerByEmail({
      email,
      name,
      phone,

      address: shippingAddress
        ? (shippingAddress as Prisma.InputJsonValue)
        : undefined,

      country: country ?? undefined,
    });

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
    }
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