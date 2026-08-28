import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { findOrCreateCustomerByEmail, recordCustomerEvent } from "@/lib/customers/identity";
import { deductStockForOrder, type CartLine } from "@/lib/orders/stock";
import { computeEffectivePrice } from "@/lib/pricing/effective-price";
import { generateUniqueValueLike } from "@/lib/utils/slug";

export const runtime = "nodejs"; // crypto.createHmac requires the Node runtime, not Edge

/**
 * ASSUMED PAYLOAD CONTRACT — documented here because nothing else in this
 * repository defines it (there is no checkout-initiation endpoint in this
 * admin-only codebase; that lives in the separate storefront project).
 * Whatever initializes the Paystack transaction on the storefront side
 * MUST pass this shape as `metadata` for the webhook to be able to
 * reconstruct the order:
 *
 *   metadata: {
 *     cart: [{ productId: string, variantId?: string, quantity: number }],
 *     shippingAddress: { ...any JSON-serializable shipping address... }
 *   }
 *
 * If the storefront's actual contract differs, update `parseCartFromMetadata`
 * below — that's the only place this assumption is encoded.
 */
type PaystackWebhookEvent = {
  event: string;
  data: {
    reference: string;
    amount: number; // kobo
    currency?: string;
    customer?: { email?: string; first_name?: string; last_name?: string; phone?: string };
    metadata?: {
      cart?: { productId: string; variantId?: string; quantity: number }[];
      shippingAddress?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
};

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  // Timing-safe comparison — signatureHeader is attacker-controlled input.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCartFromMetadata(data: PaystackWebhookEvent["data"]): CartLine[] {
  const cart = data.metadata?.cart;
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error(
      "Webhook payload has no metadata.cart — cannot reconstruct order items. See the ASSUMED PAYLOAD CONTRACT comment in this file."
    );
  }
  return cart.map((line) => ({
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: line.quantity,
  }));
}

async function generateOrderNumber() {
  const base = `GB${new Date().getFullYear()}`;
  return generateUniqueValueLike(base, async (candidate) => {
    const existing = await prisma.order.findUnique({ where: { orderNumber: candidate } });
    return !!existing;
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifySignature(rawBody, signature)) {
    // Deliberately generic + 401, not a detailed error — this endpoint is
    // a public target for forged requests, so it should reveal nothing
    // about why verification failed.
    return NextResponse.json({ received: false }, { status: 401 });
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  try {
    if (event.event === "charge.success") {
      await handleChargeSuccess(event.data);
    } else if (event.event === "charge.failed") {
      await handleChargeFailed(event.data);
    }
    // Any other event type: acknowledge without action — Paystack sends
    // many event types this MVP doesn't need to react to (transfer.*,
    // subscription.*, etc.); a non-2xx response would cause needless
    // retries for events we were never going to handle anyway.
  } catch (err) {
    // Logged, not thrown to the response — Paystack retries on non-2xx,
    // and a payload/data problem (e.g. a product referenced in the cart
    // was deleted) won't fix itself on retry. Surfacing 200 here with the
    // failure recorded in ActivityLog means an admin can investigate via
    // the activity log rather than Paystack endlessly re-delivering a
    // webhook that will never succeed.
    console.error("Paystack webhook processing error:", err);
    await logActivity({
      systemSource: "paystack_webhook",
      action: "WEBHOOK_PROCESSING_ERROR",
      resource: `PaystackEvent:${event.event}`,
      metadata: { error: err instanceof Error ? err.message : String(err), reference: event.data?.reference },
    });
  }

  // Always 200 once the signature is valid and the body parses — this is
  // what tells Paystack "received," independent of whether our internal
  // processing succeeded (see the catch block above for why).
  return NextResponse.json({ received: true }, { status: 200 });
}

async function handleChargeSuccess(data: PaystackWebhookEvent["data"]) {
  // IDEMPOTENCY GUARD: if an Order already exists for this Paystack
  // reference, this is a duplicate webhook delivery (Paystack retries
  // until it gets a 200) — do nothing further. This check-then-create is
  // an application-level guard, not a database-level one (Order.
  // paymentReference has no @@unique constraint in the current schema —
  // see CHANGES.md Phase 2 SCHEMA GAPS). Recommended for Phase 8.
  const existingOrder = await prisma.order.findFirst({ where: { paymentReference: data.reference } });
  if (existingOrder) return;

  const email = data.customer?.email;
  if (!email) throw new Error("charge.success webhook has no customer email — cannot resolve identity.");

  const name = [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(" ") || email;
  const shippingAddress = data.metadata?.shippingAddress;
  // The customer's own "location" on file is kept as their MOST RECENT
  // delivery address (see findOrCreateCustomerByEmail's top comment) —
  // `country` is pulled out separately when present under a common key,
  // for the Customers page's own "location" column; the full address
  // blob is still stored as-is on `Customer.address` either way.
  const country =
    shippingAddress && typeof shippingAddress === "object"
      ? ((shippingAddress as Record<string, unknown>).country as string | undefined) ??
        ((shippingAddress as Record<string, unknown>).countryCode as string | undefined)
      : undefined;
  const customer = await findOrCreateCustomerByEmail({
    email,
    name,
    phone: data.customer?.phone,
    // `shippingAddress` is typed as `Record<string, unknown>` (see the
    // ASSUMED PAYLOAD CONTRACT above — it's whatever JSON.parse() gave
    // us from the webhook body). TypeScript can't structurally verify an
    // `unknown`-valued Record satisfies Prisma's recursive
    // `InputJsonValue` union at compile time, even though at runtime
    // this IS valid JSON (it came from JSON.parse). Casting to
    // `Prisma.InputJsonValue` — Prisma's own exported type for exactly
    // this situation — is the correct, type-safe bridge here, not a
    // shortcut: it asserts the specific recursive JSON type Prisma
    // expects, never `any`.
    address: shippingAddress as Prisma.InputJsonValue | undefined,
    country: country ?? undefined,
  });

  const cartLines = parseCartFromMetadata(data);

  const products = await prisma.product.findMany({
    where: { id: { in: cartLines.map((l) => l.productId) } },
    select: { id: true, price: true, discount: true, costPrice: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  /**
   * CRITICAL: the amount actually charged/recorded must reflect the
   * product's discount at order time, not the full listed price — this
   * was a real bug (unitPrice previously used `product.price` directly,
   * silently ignoring `discount` entirely). Computed once here via the
   * shared `computeEffectivePrice()` helper (also used by the public
   * product API, so the storefront's displayed selling price and the
   * price actually charged can never disagree), and then written into
   * `OrderItem.unitPrice` — a real, already-existing Decimal column that
   * is captured ONCE at creation and never recomputed. If the admin
   * changes the product's discount tomorrow, this order's stored
   * unitPrice is completely unaffected, exactly as required.
   */
  let subtotal = 0;
  let costBasis = 0;
  const effectiveUnitPriceByLine = new Map<string, number>();
  for (const line of cartLines) {
    const product = productById.get(line.productId);
    if (!product) throw new Error(`Cart references unknown product ${line.productId}`);
    const effectiveUnitPrice = computeEffectivePrice(Number(product.price), product.discount ? Number(product.discount) : 0);
    effectiveUnitPriceByLine.set(`${line.productId}:${line.variantId ?? ""}`, effectiveUnitPrice);
    subtotal += effectiveUnitPrice * line.quantity;
    costBasis += Number(product.costPrice) * line.quantity;
  }

  const orderNumber = await generateOrderNumber();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        status: "PENDING", // payment confirmed + stock deducted, per the corrected business rule
        shippingAddress: (data.metadata?.shippingAddress ?? {}) as object,
        paymentReference: data.reference,
        subtotal,
        // profit uses CURRENT costPrice at the time of the order, not a
        // historical snapshot — OrderItem has no cost column to snapshot
        // into (see CHANGES.md Phase 2 SCHEMA GAPS). Fine for MVP;
        // becomes inaccurate only if costPrice changes after the sale.
        profit: subtotal - costBasis,
        items: {
          create: cartLines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            quantity: line.quantity,
            unitPrice: effectiveUnitPriceByLine.get(`${line.productId}:${line.variantId ?? ""}`)!,
          })),
        },
        timeline: { create: { label: "Payment Confirmed" } },
      },
    });

    const { shortfalls } = await deductStockForOrder(tx, cartLines);
    if (shortfalls.length > 0) {
      // Stock went negative-relative-to-demand between the storefront's
      // last availability check and payment completing (e.g. two
      // customers checking out the last unit near-simultaneously). The
      // order still stands — the customer paid — but an admin needs to
      // know a line couldn't be fully reserved from stock.
      await tx.orderNote.create({
        data: {
          orderId: created.id,
          note: `Stock shortfall at fulfillment: ${shortfalls
            .map((s) => `${s.productId}${s.variantId ? `/${s.variantId}` : ""} requested ${s.requested}, only ${s.deducted} available`)
            .join("; ")}`,
          createdBy: "system:paystack_webhook",
        },
      });
    }

    return created;
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: { lastPurchase: new Date() }, // lifetimeValue/lifecycle are derived at read time — see lib/actions/customers.ts
  });

  await logActivity({
    systemSource: "paystack_webhook",
    action: "ORDER_CREATED",
    resource: `Order:${order.id}`,
    metadata: { orderNumber, reference: data.reference, subtotal },
  });
}

async function handleChargeFailed(data: PaystackWebhookEvent["data"]) {
  const email = data.customer?.email;
  // A failed charge with no email at all can't be tied to any customer
  // record — nothing to recover here (see master prompt: "Failed payment
  // data should be usable for customer recovery," which requires an
  // identity to recover TO).
  if (!email) return;

  const name = [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(" ") || email;
  const customer = await findOrCreateCustomerByEmail({ email, name, phone: data.customer?.phone });

  // No dedicated PaymentAttempt model exists (see CHANGES.md Phase 2
  // SCHEMA GAPS) — recorded on the customer's own timeline instead, via
  // the CustomerEvent model that already exists for exactly this kind of
  // generic lifecycle touchpoint.
  await recordCustomerEvent(customer.id, "PAYMENT_FAILED", {
    reference: data.reference,
    amount: data.amount,
    currency: data.currency ?? "NGN",
  });

  await logActivity({
    systemSource: "paystack_webhook",
    action: "PAYMENT_FAILED",
    resource: `Customer:${customer.id}`,
    metadata: { reference: data.reference },
  });
}
