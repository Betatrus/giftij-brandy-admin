import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { orderStatusQuerySchema } from "@/lib/validators/public/checkout";
import { prisma } from "@/lib/prisma";

/**
 * The storefront polls this after Paystack redirects back to
 * /checkout/callback?reference=... — it must NEVER treat that redirect
 * alone as "the order succeeded" (a closed tab, a network blip, or an
 * outright forged redirect can all produce that URL without a real
 * payment). This endpoint is the only thing allowed to say "confirmed":
 * it reports whatever `Order.paymentReference` actually reflects, and
 * that row only ever gets created by the Paystack webhook after Paystack
 * itself verifies the charge (see app/api/webhooks/paystack/route.ts).
 *
 * If no Order exists yet, we ask Paystack directly whether the charge
 * succeeded, so the storefront can show "confirming your payment…"
 * instead of a false failure while the webhook is still in flight —
 * but that response is explicitly `processing`, never `confirmed`.
 */
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`public:order-status:${ip}`, 60, 60_000);
    if (!rateLimit.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    }

    const { reference } = orderStatusQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const order = await prisma.order.findFirst({
      where: { paymentReference: reference },
      select: { orderNumber: true, status: true, stockUnavailable: true, createdAt: true },
    });

    if (order) {
      // Internal stock allocation state must never be exposed to customers.
      // A verified payment remains successful even when fulfilment needs admin attention.
      return withCors(
        ok({ status: "confirmed" as const, orderNumber: order.orderNumber }),
        origin,
      );

      return withCors(
        ok({ status: "confirmed" as const, orderNumber: order.orderNumber }),
        origin,
      );
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      return withCors(ok({ status: "processing" as const }), origin);
    }

    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const verifyJson = (await verifyRes.json().catch(() => null)) as
      | { status?: boolean; data?: { status?: string } }
      | null;

    const paystackStatus = verifyJson?.data?.status;

    if (paystackStatus === "success") {
      // Paystack confirms the charge, but our own Order row (created by
      // the webhook) hasn't landed yet — genuinely still processing, not
      // failed and not confirmed.
      return withCors(ok({ status: "processing" as const }), origin);
    }

    if (paystackStatus === "failed" || paystackStatus === "abandoned") {
      return withCors(ok({ status: "failed" as const }), origin);
    }

    // Unknown reference, or Paystack itself unreachable — don't guess.
    return withCors(ok({ status: "processing" as const }), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
