import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { checkoutCartLineSchema } from "@/lib/validators/public/checkout";
import { resolveCartLines } from "@/lib/orders/resolve-cart";
import { estimatePaystackLocalFeeKobo } from "@/lib/paystack/fee-estimate";

const feeEstimateSchema = z.object({
  cart: z.array(checkoutCartLineSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const rateLimit = checkRateLimit(`public:checkout-fee-estimate:${getClientIp(req)}`, 60, 60_000);
    if (!rateLimit.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    }

    const body = feeEstimateSchema.parse(await req.json());
    const lines = await resolveCartLines(body.cart);
    const subtotalKobo = Math.round(
      lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) * 100,
    );
    if (!Number.isSafeInteger(subtotalKobo) || subtotalKobo <= 0) {
      throw new ApiError("VALIDATION_ERROR", "Your cart total must be greater than zero.");
    }

    const feeEstimateKobo = estimatePaystackLocalFeeKobo(subtotalKobo);
    return withCors(ok({
      currency: "NGN",
      estimated: true,
      subtotalKobo,
      feeEstimateKobo,
      estimatedTotalKobo: subtotalKobo + feeEstimateKobo,
    }), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
