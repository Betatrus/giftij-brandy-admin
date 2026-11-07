import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../lib/prisma";
import {
  reserveStockForCheckout,
  attachPaymentReferenceToReservation,
  releaseCheckoutReservation,
  releaseCheckoutReservationByReference,
  releaseExpiredCheckoutReservations,
  consumeCheckoutReservation,
  CHECKOUT_RESERVATION_TTL_MS,
  StockReservationUnavailableError,
} from "../lib/orders/stock-reservation";
import { POST as paystackWebhook } from "../app/api/webhooks/paystack/route";
import { POST as checkoutInitialize } from "../app/api/v1/public/checkout/initialize/route";
import { GET as reservationCron } from "../app/api/cron/expire-checkout-reservations/route";
import { GET as publicBlog } from "../app/api/v1/public/blog/route";
import { GET as publicBlogPost } from "../app/api/v1/public/blog/[slug]/route";
import { GET as publicBlogSettings } from "../app/api/v1/public/blog-settings/route";

const TEST_PAYSTACK_SECRET = "giftij-preview-only-mocked-paystack-secret";
process.env.PAYSTACK_SECRET_KEY = TEST_PAYSTACK_SECRET;

const suffix = randomUUID().replace(/-/g, "");
const productIds: string[] = [];
const reservationIds: string[] = [];
const paymentReferences: string[] = [];
const customerEmails: string[] = [];
const blogCategoryIds: string[] = [];
const blogPostIds: string[] = [];
const mockVerifications = new Map<string, { amount: number; currency: string }>();
const initializeResponses: Array<Record<string, unknown>> = [];
let lastInitializeBody: Record<string, any> | null = null;
const originalFetch = globalThis.fetch;

function logPass(name: string) {
  console.log(`[preview-tests] PASS: ${name}`);
}

async function createInventoryProduct(label: string, stock: number) {
  const product = await prisma.product.create({
    data: {
      slug: `preview-test-${label}-${suffix}`,
      name: `Preview Test ${label}`,
      shortDesc: "Temporary isolated Preview test product",
      fullDesc: "Temporary test record. Safe to delete after the test.",
      sku: `PREVIEW-${label.toUpperCase()}-${suffix}`,
      price: 100,
      costPrice: 40,
      status: "ACTIVE",
      tags: [],
      featuredFlags: [],
      inventory: {
        create: {
          currentStock: stock,
          reservedStock: 0,
          soldStock: 0,
          damagedStock: 0,
          returnedStock: 0,
        },
      },
    },
    select: { id: true },
  });
  productIds.push(product.id);
  return product.id;
}

async function createVariantProduct(stock: number) {
  const product = await prisma.product.create({
    data: {
      slug: `preview-test-variant-${suffix}`,
      name: "Preview Test Variant",
      shortDesc: "Temporary isolated Preview test product",
      fullDesc: "Temporary test record. Safe to delete after the test.",
      sku: `PREVIEW-VP-${suffix}`,
      price: 100,
      costPrice: 40,
      status: "ACTIVE",
      variantType: "color",
      tags: [],
      featuredFlags: [],
    },
    select: { id: true },
  });
  productIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      value: "Preview Black",
      color: "Preview Black",
      sku: `PREVIEW-V-${suffix}`,
      status: "ACTIVE",
      currentStock: stock,
      reservedStock: 0,
      soldStock: 0,
      damagedStock: 0,
      returnedStock: 0,
    },
    select: { id: true },
  });
  return { productId: product.id, variantId: variant.id };
}

async function inventoryFor(productId: string) {
  return prisma.inventory.findUniqueOrThrow({
    where: { productId },
    select: { currentStock: true, reservedStock: true, soldStock: true },
  });
}

async function variantInventoryFor(variantId: string) {
  return prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { currentStock: true, reservedStock: true, soldStock: true },
  });
}

function newReference(label: string) {
  const reference = `PREVIEW_${label}_${suffix}`;
  paymentReferences.push(reference);
  return reference;
}

function customerEmail(label: string) {
  const email = `${label}-${suffix}@preview-tests.invalid`;
  customerEmails.push(email);
  return email;
}

function eventFor(
  eventName: "charge.success" | "charge.failed",
  reference: string,
  reservationId: string,
  productId: string,
  email: string,
  options: { amount?: number; currency?: string; unitPrice?: number; quantity?: number } = {},
) {
  const unitPrice = options.unitPrice ?? 100;
  const quantity = options.quantity ?? 1;
  const amount = options.amount ?? Math.round(unitPrice * quantity * 100);
  return {
    event: eventName,
    data: {
      reference,
      amount,
      currency: options.currency ?? "NGN",
      customer: {
        email,
        first_name: "Preview",
        last_name: "Test",
        phone: "08000000000",
      },
      metadata: {
        reservationId,
        expectedAmountKobo: Math.round(unitPrice * quantity * 100),
        cart: [{ productId, quantity, unitPrice }],
        shippingAddress: {
          fullName: "Preview Test Customer",
          phone: "08000000000",
          country: "Nigeria",
        },
      },
    },
  };
}

async function callWebhook(payload: object, signatureOverride?: string) {
  const body = JSON.stringify(payload);
  const signature = signatureOverride ??
    createHmac("sha512", TEST_PAYSTACK_SECRET).update(body).digest("hex");
  const request = new NextRequest("https://giftij-preview-test.invalid/api/webhooks/paystack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-paystack-signature": signature,
    },
    body,
  });
  const response = await paystackWebhook(request);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/transaction/initialize")) {
    lastInitializeBody = JSON.parse(String(init?.body ?? "{}"));
    const response = initializeResponses.shift() ?? { status: false, message: "No preview initialize mock configured." };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const reference = decodeURIComponent(url.split("/").pop() ?? "");
  const verification = mockVerifications.get(reference);
  if (!verification) {
    return new Response(JSON.stringify({ status: false, message: "Unconfigured preview mock" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    status: true,
    data: {
      reference,
      status: "success",
      amount: verification.amount,
      currency: verification.currency,
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

async function callCheckout(body: object) {
  const request = new NextRequest("https://giftij-preview-test.invalid/api/v1/public/checkout/initialize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: process.env.STOREFRONT_URL ?? "https://storefront-preview.invalid",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify(body),
  });
  const response = await checkoutInitialize(request);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main() {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.PREVIEW_DATABASE_URL) {
    throw new Error("Preview integration tests may run only with PREVIEW_DATABASE_URL configured.");
  }

  // Exact seven-minute reservation window and atomic hold/release.
  {
    const productId = await createInventoryProduct("ttl", 5);
    const reservation = await reserveStockForCheckout([{ productId, quantity: 2 }]);
    reservationIds.push(reservation.reservationId);
    const ttl = reservation.expiresAt.getTime() - Date.now();
    assert.ok(Math.abs(ttl - CHECKOUT_RESERVATION_TTL_MS) < 2_000, "reservation must last exactly seven minutes");
    assert.deepEqual(await inventoryFor(productId), { currentStock: 3, reservedStock: 2, soldStock: 0 });
    assert.equal(await releaseCheckoutReservation(reservation.reservationId), true);
    assert.equal(await releaseCheckoutReservation(reservation.reservationId), false);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 5, reservedStock: 0, soldStock: 0 });
    logPass("seven-minute reservation, hold/release, and idempotent release");
  }

  // A multi-line cart must roll back completely when one line is unavailable.
  {
    const first = await createInventoryProduct("atomic-a", 5);
    const second = await createInventoryProduct("atomic-b", 1);
    await assert.rejects(
      reserveStockForCheckout([
        { productId: first, quantity: 2 },
        { productId: second, quantity: 2 },
      ]),
      (error: unknown) => error instanceof StockReservationUnavailableError,
    );
    assert.deepEqual(await inventoryFor(first), { currentStock: 5, reservedStock: 0, soldStock: 0 });
    assert.deepEqual(await inventoryFor(second), { currentStock: 1, reservedStock: 0, soldStock: 0 });
    logPass("all-or-nothing cart reservation rollback");
  }

  // Concurrent requests cannot reserve more units than the database owns.
  {
    const productId = await createInventoryProduct("concurrency", 5);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveStockForCheckout([{ productId, quantity: 1 }])),
    );
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 5);
    assert.equal(failures.length, 5);
    assert.ok(failures.every((result) =>
      result.status === "rejected" && result.reason instanceof StockReservationUnavailableError
    ));
    const ids = successes.map((result) => {
      if (result.status !== "fulfilled") throw new Error("Unexpected rejected reservation.");
      reservationIds.push(result.value.reservationId);
      return result.value.reservationId;
    });
    assert.deepEqual(await inventoryFor(productId), { currentStock: 0, reservedStock: 5, soldStock: 0 });
    for (const id of ids) assert.equal(await releaseCheckoutReservation(id), true);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 5, reservedStock: 0, soldStock: 0 });
    logPass("concurrent reservation cap prevents overselling");
  }

  // Variant inventory follows the same reserve/release rules.
  {
    const { productId, variantId } = await createVariantProduct(4);
    const reservation = await reserveStockForCheckout([{ productId, variantId, quantity: 2 }]);
    reservationIds.push(reservation.reservationId);
    assert.deepEqual(await variantInventoryFor(variantId), { currentStock: 2, reservedStock: 2, soldStock: 0 });
    assert.equal(await releaseCheckoutReservation(reservation.reservationId), true);
    assert.deepEqual(await variantInventoryFor(variantId), { currentStock: 4, reservedStock: 0, soldStock: 0 });
    logPass("variant stock reservation and release");
  }

  // Successful payment consumes reservedStock without decrementing currentStock again.
  {
    const productId = await createInventoryProduct("consume", 5);
    const reference = newReference("CONSUME");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 2 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    const first = await prisma.$transaction((tx) => consumeCheckoutReservation(tx, reference));
    const second = await prisma.$transaction((tx) => consumeCheckoutReservation(tx, reference));
    assert.equal(first.consumed, true);
    assert.equal(second.consumed, false);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 3, reservedStock: 0, soldStock: 2 });
    logPass("successful payment consumes reservation exactly once");
  }

  // Expired reservations release stock once, even if cleanup is repeated.
  {
    const productId = await createInventoryProduct("expiry", 3);
    const reservation = await reserveStockForCheckout([{ productId, quantity: 2 }]);
    reservationIds.push(reservation.reservationId);
    await prisma.checkoutReservation.update({
      where: { id: reservation.reservationId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    // This bounded cleanup is global and may also release expired reservations
    // left by an interrupted earlier Preview run. Assert this test reservation's
    // state and inventory, not the total number of unrelated rows in the batch.
    await releaseExpiredCheckoutReservations(25);
    await releaseExpiredCheckoutReservations(25);
    const saved = await prisma.checkoutReservation.findUniqueOrThrow({
      where: { id: reservation.reservationId },
      select: { status: true },
    });
    assert.equal(saved.status, "EXPIRED");
    assert.deepEqual(await inventoryFor(productId), { currentStock: 3, reservedStock: 0, soldStock: 0 });
    logPass("expired reservation cleanup is idempotent");
  }

  // Checkout initialization reserves stock before Paystack and releases it if Paystack init fails.
  {
    const productId = await createInventoryProduct("init-failure", 3);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { slug: true },
    });
    initializeResponses.push({ status: false, message: "Mocked Paystack initialization failure." });
    const result = await callCheckout({
      email: customerEmail("init-failure"),
      cart: [{ productSlug: product.slug, quantity: 2 }],
      shippingAddress: {
        fullName: "Preview Test Customer",
        phone: "08000000000",
        address: "1 Preview Test Road",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
    });
    assert.notEqual(result.status, 200);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 3, reservedStock: 0, soldStock: 0 });
    logPass("failed Paystack initialization releases the temporary reservation");
  }

  // Full checkout-to-webhook flow, including callback URL, amount snapshot and concurrent duplicate notifications.
  {
    const productId = await createInventoryProduct("checkout-flow", 4);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { slug: true },
    });
    const reference = newReference("CHECKOUT_FLOW");
    const email = customerEmail("checkout-flow");
    initializeResponses.push({
      status: true,
      data: {
        authorization_url: "https://checkout.paystack.test/preview",
        access_code: "preview-test-access-code",
        reference,
      },
    });
    const checkout = await callCheckout({
      email,
      cart: [{ productSlug: product.slug, quantity: 2 }],
      shippingAddress: {
        fullName: "Preview Test Customer",
        phone: "08000000000",
        address: "1 Preview Test Road",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
    });
    assert.equal(checkout.status, 200);
    assert.ok(lastInitializeBody);
    assert.equal(lastInitializeBody.callback_url, `${process.env.STOREFRONT_URL}/checkout/callback`);
    const metadata = lastInitializeBody.metadata;
    assert.equal(metadata.expectedAmountKobo, 20_000);
    assert.equal(metadata.cart[0].productId, productId);
    const reservationId = String(metadata.reservationId);
    reservationIds.push(reservationId);
    const reservation = await prisma.checkoutReservation.findUniqueOrThrow({
      where: { id: reservationId },
      select: { status: true, paymentReference: true },
    });
    assert.equal(reservation.status, "ACTIVE");
    assert.equal(reservation.paymentReference, reference);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 2, soldStock: 0 });

    const payload = {
      event: "charge.success",
      data: {
        reference,
        // Simulate Paystack passing its NGN153 customer-paid fee through
        // on top of the NGN200 product subtotal.
        amount: metadata.expectedAmountKobo + 153,
        currency: "NGN",
        customer: { email, first_name: "Preview", last_name: "Test" },
        metadata,
      },
    };
    mockVerifications.set(reference, { amount: 20_153, currency: "NGN" });
    const results = await Promise.all([callWebhook(payload), callWebhook(payload)]);
    assert.ok(results.every((result) => result.status === 200));
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 1);
    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { paymentReference: reference },
      select: { subtotal: true },
    });
    assert.equal(Number(paidOrder.subtotal), 200);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 0, soldStock: 2 });
    logPass("checkout initialization accepts customer-paid Paystack fees, preserves product subtotal, and consumes stock once");
  }

  // Public blog endpoints expose only published content to the shared Preview API key.
  {
    const storefrontSecret = process.env.STOREFRONT_API_SECRET?.trim();
    if (!storefrontSecret) throw new Error("STOREFRONT_API_SECRET is required for Preview blog API tests.");
    await prisma.storeSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", blogNavigationVisible: true, blogIndexingEnabled: false },
      update: { blogNavigationVisible: true, blogIndexingEnabled: false },
    });
    const category = await prisma.blogCategory.create({
      data: { name: "Preview Tests", slug: `preview-tests-${suffix}` },
      select: { id: true },
    });
    blogCategoryIds.push(category.id);
    const published = await prisma.blogPost.create({
      data: {
        title: "Preview Published Article",
        slug: `preview-published-${suffix}`,
        excerpt: "Temporary published article for Preview API tests.",
        contentMarkdown: "# Preview article\n\nTemporary content.",
        status: "PUBLISHED",
        publishedAt: new Date(Date.now() - 60_000),
        isIndexable: true,
        categoryId: category.id,
      },
      select: { id: true, slug: true },
    });
    blogPostIds.push(published.id);
    const draft = await prisma.blogPost.create({
      data: {
        title: "Preview Draft Article",
        slug: `preview-draft-${suffix}`,
        excerpt: "Temporary draft article for Preview API tests.",
        contentMarkdown: "Draft content.",
        status: "DRAFT",
        categoryId: category.id,
      },
      select: { id: true, slug: true },
    });
    blogPostIds.push(draft.id);
    await prisma.blogPostSlugRedirect.create({
      data: { fromSlug: `preview-old-${suffix}`, postId: published.id },
    });

    const origin = process.env.STOREFRONT_URL ?? "https://storefront-preview.invalid";
    const headers = { "X-Storefront-Key": storefrontSecret, origin };
    const listResponse = await publicBlog(new NextRequest("https://admin-preview.invalid/api/v1/public/blog", { headers }));
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("access-control-allow-origin"), origin);
    const listPayload = await listResponse.json() as { success: boolean; data: Array<{ slug: string; isIndexable: boolean }> };
    assert.equal(listPayload.success, true);
    assert.ok(listPayload.data.some((post) => post.slug === published.slug));
    assert.ok(!listPayload.data.some((post) => post.slug === draft.slug));
    assert.equal(listPayload.data.find((post) => post.slug === published.slug)?.isIndexable, false);

    await prisma.storeSettings.update({
      where: { id: "singleton" },
      data: { blogIndexingEnabled: true },
    });
    const settingsResponse = await publicBlogSettings(new NextRequest("https://admin-preview.invalid/api/v1/public/blog-settings", { headers }));
    const settingsPayload = await settingsResponse.json() as { data: { blogNavigationVisible: boolean; blogIndexingEnabled: boolean } };
    assert.equal(settingsPayload.data.blogNavigationVisible, true);
    assert.equal(settingsPayload.data.blogIndexingEnabled, true);

    const articleResponse = await publicBlogPost(
      new NextRequest(`https://admin-preview.invalid/api/v1/public/blog/${published.slug}`, { headers }),
      { params: Promise.resolve({ slug: published.slug }) },
    );
    const articlePayload = await articleResponse.json() as { data: { contentMarkdown: string } };
    assert.equal(articleResponse.status, 200);
    assert.ok(articlePayload.data.contentMarkdown.includes("Temporary content"));

    const draftResponse = await publicBlogPost(
      new NextRequest(`https://admin-preview.invalid/api/v1/public/blog/${draft.slug}`, { headers }),
      { params: Promise.resolve({ slug: draft.slug }) },
    );
    assert.equal(draftResponse.status, 404);

    const redirectResponse = await publicBlogPost(
      new NextRequest(`https://admin-preview.invalid/api/v1/public/blog/preview-old-${suffix}`, { headers }),
      { params: Promise.resolve({ slug: `preview-old-${suffix}` }) },
    );
    const redirectPayload = await redirectResponse.json() as { redirectTo: string };
    assert.equal(redirectPayload.redirectTo, published.slug);

    const unauthorized = await publicBlog(new NextRequest("https://admin-preview.invalid/api/v1/public/blog"));
    assert.equal(unauthorized.status, 401);
    logPass("blog list/detail/settings, draft exclusion, indexability, redirects, API key and CORS");
  }

  // Failed Paystack charge releases its reservation; signature is verified locally.
  {
    const productId = await createInventoryProduct("failed", 2);
    const reference = newReference("FAILED");
    const email = customerEmail("failed");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    const payload = eventFor("charge.failed", reference, reservation.reservationId, productId, email);
    const result = await callWebhook(payload);
    assert.equal(result.status, 200);
    assert.equal(result.body.received, true);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 0, soldStock: 0 });
    logPass("charge.failed webhook releases held stock");
  }

  // Invalid signatures are rejected before any Paystack verification or writes.
  {
    const productId = await createInventoryProduct("bad-signature", 2);
    const reference = newReference("BAD_SIGNATURE");
    const email = customerEmail("bad-signature");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    const payload = eventFor("charge.success", reference, reservation.reservationId, productId, email);
    const result = await callWebhook(payload, "invalid-signature");
    assert.equal(result.status, 401);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 1, reservedStock: 1, soldStock: 0 });
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 0);
    await releaseCheckoutReservation(reservation.reservationId);
    logPass("invalid Paystack signature rejected without stock/order writes");
  }

  // Provider amount mismatch is acknowledged but ignored; reserved stock stays held.
  {
    const productId = await createInventoryProduct("wrong-amount", 2);
    const reference = newReference("WRONG_AMOUNT");
    const email = customerEmail("wrong-amount");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    mockVerifications.set(reference, { amount: 9_900, currency: "NGN" });
    const result = await callWebhook(eventFor("charge.success", reference, reservation.reservationId, productId, email));
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, true);
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 0);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 1, reservedStock: 1, soldStock: 0 });
    await releaseCheckoutReservation(reservation.reservationId);
    logPass("Paystack amount mismatch ignored without consuming stock");
  }

  // Currency mismatch is rejected too.
  {
    const productId = await createInventoryProduct("wrong-currency", 2);
    const reference = newReference("WRONG_CURRENCY");
    const email = customerEmail("wrong-currency");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    mockVerifications.set(reference, { amount: 10_000, currency: "NGN" });
    const payload = eventFor("charge.success", reference, reservation.reservationId, productId, email, { currency: "USD" });
    const result = await callWebhook(payload);
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, true);
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 0);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 1, reservedStock: 1, soldStock: 0 });
    await releaseCheckoutReservation(reservation.reservationId);
    logPass("Paystack currency mismatch ignored without consuming stock");
  }

  // Concurrent duplicate success notifications create one order and consume stock once.
  {
    const productId = await createInventoryProduct("duplicate-webhook", 4);
    const reference = newReference("DUPLICATE");
    const email = customerEmail("duplicate");
    const reservation = await reserveStockForCheckout([{ productId, quantity: 2 }]);
    reservationIds.push(reservation.reservationId);
    await attachPaymentReferenceToReservation(reservation.reservationId, reference);
    const payload = eventFor("charge.success", reference, reservation.reservationId, productId, email, { quantity: 2 });
    mockVerifications.set(reference, { amount: 20_000, currency: "NGN" });
    const results = await Promise.all([callWebhook(payload), callWebhook(payload)]);
    assert.ok(results.every((result) => result.status === 200));
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 1);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 0, soldStock: 2 });
    const duplicate = await callWebhook(payload);
    assert.equal(duplicate.status, 200);
    assert.equal(await prisma.order.count({ where: { paymentReference: reference } }), 1);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 0, soldStock: 2 });
    logPass("duplicate and concurrent Paystack success webhooks are idempotent");
  }

  // A verified late payment with no available stock creates an Admin review order without overselling.
  {
    const productId = await createInventoryProduct("late-payment", 1);
    const reference = newReference("LATE");
    const email = customerEmail("late");
    const expiredReservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(expiredReservation.reservationId);
    await attachPaymentReferenceToReservation(expiredReservation.reservationId, reference);
    await prisma.checkoutReservation.update({
      where: { id: expiredReservation.reservationId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    assert.equal(await releaseExpiredCheckoutReservations(25), 1);

    const secondReservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(secondReservation.reservationId);
    const latePayload = eventFor("charge.success", reference, expiredReservation.reservationId, productId, email);
    mockVerifications.set(reference, { amount: 10_000, currency: "NGN" });
    const result = await callWebhook(latePayload);
    assert.equal(result.status, 200);
    const order = await prisma.order.findUniqueOrThrow({
      where: { paymentReference: reference },
      select: { id: true, stockUnavailable: true },
    });
    assert.equal(order.stockUnavailable, true);
    const note = await prisma.orderNote.findFirst({
      where: { orderId: order.id },
      select: { note: true },
    });
    assert.ok(note?.note.includes("PAID - STOCK UNAVAILABLE"));
    assert.deepEqual(await inventoryFor(productId), { currentStock: 0, reservedStock: 1, soldStock: 0 });
    logPass("late verified payment is flagged Paid - Stock Unavailable without overselling");
  }
  // The scheduled cleanup endpoint requires its Preview-only bearer secret.
  {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) throw new Error("CRON_SECRET is required for Preview cron tests.");
    const productId = await createInventoryProduct("cron", 2);
    const reservation = await reserveStockForCheckout([{ productId, quantity: 1 }]);
    reservationIds.push(reservation.reservationId);
    await prisma.checkoutReservation.update({
      where: { id: reservation.reservationId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const wrongAuth = await reservationCron(new NextRequest("https://admin-preview.invalid/api/cron/expire-checkout-reservations", {
      headers: { authorization: "Bearer wrong-preview-secret" },
    }));
    assert.equal(wrongAuth.status, 401);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 1, reservedStock: 1, soldStock: 0 });

    const authorized = await reservationCron(new NextRequest("https://admin-preview.invalid/api/cron/expire-checkout-reservations", {
      headers: { authorization: `Bearer ${cronSecret}` },
    }));
    assert.equal(authorized.status, 200);
    const cronPayload = await authorized.json() as { ok: boolean; released: number };
    assert.equal(cronPayload.ok, true);
    assert.equal(cronPayload.released, 1);
    assert.deepEqual(await inventoryFor(productId), { currentStock: 2, reservedStock: 0, soldStock: 0 });
    logPass("Preview cron authentication and expired-reservation release");
  }
}

async function cleanup() {
  if (blogPostIds.length) {
    await prisma.blogPost.deleteMany({ where: { id: { in: blogPostIds } } });
  }
  if (blogCategoryIds.length) {
    await prisma.blogCategory.deleteMany({ where: { id: { in: blogCategoryIds } } });
  }
  await prisma.storeSettings.deleteMany({ where: { id: "singleton" } });
  const orders = await prisma.order.findMany({
    where: { paymentReference: { in: paymentReferences } },
    select: { id: true, customerId: true },
  });
  const customers = await prisma.customer.findMany({
    where: { email: { in: customerEmails } },
    select: { id: true },
  });
  const resources = [
    ...paymentReferences.map((reference) => `PaystackReference:${reference}`),
    "PaystackEvent:charge.success",
    "PaystackEvent:charge.failed",
    ...orders.map((order) => `Order:${order.id}`),
    ...customers.map((customer) => `Customer:${customer.id}`),
  ];
  if (resources.length) {
    await prisma.activityLog.deleteMany({ where: { resource: { in: resources } } });
  }
  if (orders.length) {
    await prisma.order.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  }
  if (customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: customers.map((customer) => customer.id) } } });
  }
  const testReservations = await prisma.checkoutReservation.findMany({
    select: { id: true, cart: true },
  });
  const reservationIdsForCleanup = new Set(reservationIds);
  for (const reservation of testReservations) {
    if (Array.isArray(reservation.cart) && reservation.cart.some((line) =>
      typeof line === "object" && line !== null && "productId" in line &&
      typeof line.productId === "string" && productIds.includes(line.productId)
    )) {
      reservationIdsForCleanup.add(reservation.id);
    }
  }
  if (reservationIdsForCleanup.size) {
    await prisma.checkoutReservation.deleteMany({
      where: { id: { in: Array.from(reservationIdsForCleanup) } },
    });
  }
  if (productIds.length) {
    await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
}

main()
  .catch((error) => {
    console.error("[preview-tests] FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    globalThis.fetch = originalFetch;
    try {
      await cleanup();
    } catch (error) {
      console.error("[preview-tests] Cleanup failed:", error);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
  });
