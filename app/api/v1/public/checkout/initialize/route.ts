import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { checkoutInitializeSchema } from "@/lib/validators/public/checkout";
import { resolveCartLines } from "@/lib/orders/resolve-cart";
import { checkStockAvailability } from "@/lib/orders/stock";

/**
 * Starts a purchase. This is the ONLY place a Paystack transaction is
 * created — the storefront never talks to Paystack's API directly and
 * never sees PAYSTACK_SECRET_KEY. It:
 *
 *   1. resolves the storefront's cart (productSlug/sku) against the
 *      database — never trusts a client-sent price or productId,
 *   2. re-checks stock right now (the storefront's own display may be up
 *      to a minute stale, see the public product list's cache),
 *   3. computes the amount to charge from the CURRENT price/discount in
 *      the database,
 *   4. asks Paystack to open a transaction for exactly that amount, with
 *      metadata.cart in the shape app/api/webhooks/paystack/route.ts
 *      already expects (see its ASSUMED PAYLOAD CONTRACT comment) so the
 *      webhook can reconstruct and finalize the order once payment
 *      succeeds.
 *
 * This endpoint deliberately does NOT create the Order — order creation
 * only ever happens from the webhook, once Paystack itself confirms the
 * charge. That keeps a single, authoritative path for "an order exists,"
 * and means a customer closing the tab mid-payment never leaves behind a
 * phantom order.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`public:checkout-init:${ip}`, 20, 60_000);
    if (!rateLimit.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    }

    const body = checkoutInitializeSchema.parse(await req.json());

    const resolved = await resolveCartLines(body.cart);

    // Real-time stock check, immediately before payment — the storefront's
    // own product pages are cache-fronted (up to 60s stale), so this is
    // the actual gate, not just a UX nicety.
    await checkStockAvailability(
      resolved.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }))
    );

    const amountNaira = resolved.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const amountKobo = Math.round(amountNaira * 100);

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      // Misconfiguration, not a customer-caused error — logged loudly,
      // never silently "succeeds."
      console.error("PAYSTACK_SECRET_KEY is not set — cannot initialize a transaction.");
      throw new ApiError("PAYMENT_INIT_FAILED", "Payment is temporarily unavailable. Please try again shortly.");
    }

    const storefrontUrl = process.env.STOREFRONT_URL ?? "https://www.giftij.com";

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: body.email,
        amount: amountKobo,
        currency: "NGN",
        callback_url: `${storefrontUrl}/checkout/callback`,
        metadata: {
          cart: resolved.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
          shippingAddress: body.shippingAddress,
        },
      }),
    });

    const paystackJson = (await paystackRes.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: { authorization_url: string; access_code: string; reference: string } }
      | null;

    if (!paystackRes.ok || !paystackJson?.status || !paystackJson.data) {
      console.error("Paystack initialize failed:", paystackRes.status, paystackJson);
      throw new ApiError(
        "PAYMENT_INIT_FAILED",
        "We couldn't start your payment. Please try again in a moment."
      );
    }

    return withCors(
      ok({
        authorizationUrl: paystackJson.data.authorization_url,
        accessCode: paystackJson.data.access_code,
        reference: paystackJson.data.reference,
      }),
      origin
    );
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
