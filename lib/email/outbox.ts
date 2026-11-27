import { createHash } from "node:crypto";
import type { EmailEventType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/brevo";
import { renderTransactionalEmail } from "@/lib/email/templates";

type EnqueueInput = { eventKey: string; eventType: EmailEventType; recipientEmail: string; recipientName?: string | null; payload: Prisma.InputJsonValue };

// Brevo requires a UUID idempotency key. Derive a stable UUID from the
// business event key so retries of the same outbox item reuse the same key.
function brevoIdempotencyKey(eventKey: string): string {
  const bytes = createHash("sha256").update(eventKey).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function enqueueEmail(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<void> {
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) return;
  await tx.emailOutbox.upsert({
    where: { eventKey: input.eventKey },
    create: { eventKey: input.eventKey, eventType: input.eventType, recipientEmail, recipientName: input.recipientName?.trim() || null, payload: input.payload },
    update: {},
  });
}

export async function enqueueOrderEmail(tx: Prisma.TransactionClient, eventType: EmailEventType, eventKey: string, orderId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      orderNumber: true, subtotal: true, status: true, createdAt: true, trackingNumber: true,
      customer: { select: { name: true, email: true } },
      items: { select: { quantity: true, unitPrice: true, product: { select: { name: true, slug: true } }, variant: { select: { value: true } } } },
    },
  });
  await enqueueEmail(tx, {
    eventKey, eventType, recipientEmail: order.customer.email, recipientName: order.customer.name,
    payload: {
      customerName: order.customer.name, orderNumber: order.orderNumber,
      orderStatus: order.status === "PENDING" ? "Confirmed — awaiting processing" : order.status,
      orderDate: order.createdAt.toISOString(),
      subtotal: Number(order.subtotal), totalPaid: Number(order.subtotal), trackingNumber: order.trackingNumber,
      items: order.items.map((item) => ({ name: item.product.name, slug: item.product.slug, variant: item.variant?.value ?? null, quantity: item.quantity, unitPrice: Number(item.unitPrice) })),
      ...extra,
    } as Prisma.InputJsonValue,
  });
}

const CUSTOMER_SERVICE_EMAIL = "jacobsgift3@gmail.com";

/** Keep this estimate identical to the checkout fee estimate. It is display-only
 * and is never added to the product subtotal sent to Paystack. */
export function estimatePaystackLocalFeeNaira(subtotalNaira: number): number {
  const subtotalKobo = Math.round(subtotalNaira * 100);
  if (!Number.isSafeInteger(subtotalKobo) || subtotalKobo <= 0) return 0;
  const percentageRate = 0.015;
  const flatFeeKobo = subtotalKobo >= 250_000 ? 10_000 : 0;
  const feeCapKobo = 200_000;
  const feeBeforeGrossUp = subtotalKobo * percentageRate + flatFeeKobo;
  if (feeBeforeGrossUp > feeCapKobo) return feeCapKobo / 100;
  const grossAmountKobo = Math.round((subtotalKobo + flatFeeKobo) / (1 - percentageRate)) + 1;
  return Math.min(Math.max(grossAmountKobo - subtotalKobo, 0), feeCapKobo) / 100;
}

/** Queue the reservation confirmation in the same transaction that attaches
 * the Paystack session. This avoids emailing customers for a checkout that
 * failed before a usable payment session was created. */
export async function enqueueReservationCreatedEmail(tx: Prisma.TransactionClient, reservationId: string): Promise<void> {
  const reservation = await tx.checkoutReservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { id: true, createdAt: true, expiresAt: true, customerEmail: true, customerName: true, cart: true },
  });
  if (!reservation.customerEmail) return;

  const rawLines = Array.isArray(reservation.cart) ? reservation.cart : [];
  const lines = rawLines.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const line = raw as Record<string, unknown>;
    if (typeof line.productId !== "string" || !Number.isSafeInteger(line.quantity) || Number(line.quantity) <= 0) return [];
    return [{
      productId: line.productId,
      variantId: typeof line.variantId === "string" ? line.variantId : null,
      quantity: Number(line.quantity),
      name: typeof line.name === "string" ? line.name : null,
      unitPrice: typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) ? line.unitPrice : null,
    }];
  });
  if (!lines.length) return;

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.productId))] } },
    select: { id: true, name: true, slug: true, price: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const variants = await tx.productVariant.findMany({
    where: { id: { in: lines.flatMap((line) => line.variantId ? [line.variantId] : []) } },
    select: { id: true, value: true },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant.value]));
  const items = lines.map((line) => {
    const product = productById.get(line.productId);
    return {
      name: line.name || product?.name || "Giftij Brandy item",
      slug: product?.slug || "",
      variant: line.variantId ? variantById.get(line.variantId) || null : null,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? Number(product?.price ?? 0),
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const estimatedProcessingFee = estimatePaystackLocalFeeNaira(subtotal);

  await enqueueEmail(tx, {
    eventKey: `reservation-created:${reservation.id}`,
    eventType: "RESERVATION_CREATED",
    recipientEmail: reservation.customerEmail,
    recipientName: reservation.customerName,
    payload: {
      customerName: reservation.customerName || "there",
      reservationReference: reservation.id,
      placedAt: reservation.createdAt.toISOString(),
      expiresAt: reservation.expiresAt.toISOString(),
      subtotal,
      estimatedProcessingFee,
      estimatedTotal: subtotal + estimatedProcessingFee,
      items,
    } as Prisma.InputJsonValue,
  });
}

/** Queue a separate internal alert after the order has been committed. */
export async function enqueueCustomerServicePaymentReceivedEmail(
  tx: Prisma.TransactionClient,
  orderId: string,
  paymentReference: string,
  totalPaid: number,
): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      orderNumber: true, subtotal: true, createdAt: true, shippingAddress: true,
      customer: { select: { name: true, email: true, phone: true } },
      items: {
        select: {
          quantity: true, unitPrice: true,
          product: { select: { name: true, slug: true } },
          variant: { select: { value: true } },
        },
      },
    },
  });
  await enqueueEmail(tx, {
    eventKey: `customer-service-payment-received:${order.id}`,
    eventType: "CUSTOMER_SERVICE_PAYMENT_RECEIVED",
    recipientEmail: CUSTOMER_SERVICE_EMAIL,
    recipientName: "Giftij Brandy Customer Service",
    payload: {
      customerName: order.customer.name,
      customerEmail: order.customer.email,
      customerPhone: order.customer.phone,
      orderNumber: order.orderNumber,
      paymentReference,
      totalPaid,
      subtotal: Number(order.subtotal),
      orderDate: order.createdAt.toISOString(),
      shippingAddress: order.shippingAddress as Prisma.InputJsonValue,
      items: order.items.map((item) => ({
        name: item.product.name,
        slug: item.product.slug,
        variant: item.variant?.value ?? null,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    } as Prisma.InputJsonValue,
  });
}

export async function enqueuePaymentFailedEmail(tx: Prisma.TransactionClient, input: { reference: string; email?: string; name?: string; amountKobo?: number; currency?: string }): Promise<void> {
  const reservation = await tx.checkoutReservation.findUnique({
    where: { paymentReference: input.reference },
    select: { status: true, customerEmail: true, customerName: true, cart: true },
  });
  // The expiry notice already covers a late charge.failed webhook after the 10-minute release.
  // A consumed reservation is also incompatible with a customer-facing failure notice.
  if (reservation?.status === "EXPIRED" || reservation?.status === "CONSUMED") return;

  const recipientEmail = input.email?.trim().toLowerCase() || reservation?.customerEmail?.trim().toLowerCase() || "";
  if (!recipientEmail) return;

  const lines: Array<{ productId: string; variantId: string | null; quantity: number }> = [];
  if (Array.isArray(reservation?.cart)) for (const raw of reservation.cart) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const line = raw as Record<string, unknown>;
    if (typeof line.productId === "string" && Number.isSafeInteger(line.quantity) && Number(line.quantity) > 0) {
      lines.push({ productId: line.productId, variantId: typeof line.variantId === "string" ? line.variantId : null, quantity: Number(line.quantity) });
    }
  }
  const products = lines.length ? await tx.product.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.productId))] } }, select: { id: true, name: true },
  }) : [];
  const names = new Map(products.map((product) => [product.id, product.name]));
  const customerName = input.name || reservation?.customerName || "there";
  await enqueueEmail(tx, {
    eventKey: `paystack-payment-failed:${input.reference}`, eventType: "PAYMENT_FAILED",
    recipientEmail, recipientName: customerName,
    payload: {
      customerName, reference: input.reference,
      amountNaira: typeof input.amountKobo === "number" ? input.amountKobo / 100 : null,
      currency: input.currency || "NGN",
      items: lines.map((line) => ({ name: names.get(line.productId) || "Giftij Brandy item", variant: line.variantId, quantity: line.quantity })),
    } as Prisma.InputJsonValue,
  });
}

export async function processEmailOutboxBatch(limit = 10): Promise<{ claimed: number; sent: number; retried: number; failed: number }> {
  const batchSize = Math.max(1, Math.min(Math.trunc(limit) || 10, 10));
  const jobs = await prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      WITH candidates AS (
        SELECT "id" FROM "EmailOutbox"
        WHERE ("status" = 'PENDING' AND "availableAt" <= NOW())
           OR ("status" = 'PROCESSING' AND "lockedAt" <= NOW() - INTERVAL '5 minutes')
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "EmailOutbox" AS job
      SET "status" = 'PROCESSING', "lockedAt" = NOW(),
          "attempts" = job."attempts" + 1, "updatedAt" = NOW()
      FROM candidates WHERE job."id" = candidates."id"
      RETURNING job."id"
    `;
    if (!claimed.length) return [];
    return tx.emailOutbox.findMany({ where: { id: { in: claimed.map((row) => row.id) } }, orderBy: { createdAt: "asc" } });
  });
  const result = { claimed: jobs.length, sent: 0, retried: 0, failed: 0 };
  const deliver = async (job: (typeof jobs)[number]) => {
    try {
      const message = renderTransactionalEmail(job.eventType, job.payload);
      const sent = await sendEmail({
        to: job.recipientEmail, toName: job.recipientName ?? undefined,
        subject: message.subject, html: message.html, text: message.text, idempotencyKey: brevoIdempotencyKey(job.eventKey),
        tags: ["giftij-brandy", job.eventType.toLowerCase()],
      });
      await prisma.emailOutbox.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { status: "SENT", lockedAt: null, sentAt: new Date(), providerMessageId: sent.messageId, lastError: null },
      });
      result.sent += 1;
    } catch (error) {
      const terminal = job.attempts >= 6;
      const delayMs = Math.min(8 * 60 * 1000, 30_000 * (2 ** Math.max(0, job.attempts - 1)));
      await prisma.emailOutbox.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: {
          status: terminal ? "FAILED" : "PENDING", lockedAt: null,
          availableAt: new Date(Date.now() + delayMs),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 4000),
        },
      });
      if (terminal) result.failed += 1; else result.retried += 1;
      console.error("Transactional email delivery failed", { eventKey: job.eventKey, eventType: job.eventType, attempt: job.attempts, terminal, error: error instanceof Error ? error.message : String(error) });
    }
  };
  for (let index = 0; index < jobs.length; index += 5) await Promise.all(jobs.slice(index, index + 5).map(deliver));
  return result;
}
