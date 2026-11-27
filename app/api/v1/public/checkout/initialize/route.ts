import { NextRequest } from "next/server";
import {
  ok,
  fail,
} from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import {
  withCors,
  corsPreflight,
} from "@/lib/api/cors";
import {
  checkRateLimit,
  getClientIp,
} from "@/lib/api/rate-limit";
import { checkoutInitializeSchema } from "@/lib/validators/public/checkout";

export async function POST(
  req: NextRequest,
) {
  const origin =
    req.headers.get("origin");

  let reservationId:
    | string
    | null = null;

  let reservationAttachedToPaystack =
    false;
  let reservationService: typeof import("@/lib/orders/stock-reservation") | null = null;

  try {
    const ip =
      getClientIp(req);

    // Fail closed before parsing carts, reserving inventory, or contacting Paystack.
    const { prisma } = await import("@/lib/prisma");
    const storeSettings = await prisma.storeSettings.findUnique({
      where: { id: "singleton" },
      select: { checkoutLocked: true, checkoutLockMessage: true },
    });
    if (storeSettings?.checkoutLocked) {
      throw new ApiError(
        "CHECKOUT_LOCKED",
        storeSettings.checkoutLockMessage || "Checkout is temporarily unavailable. Please check back soon.",
      );
    }

    const rateLimit =
      checkRateLimit(
        `public:checkout-init:${ip}`,
        20,
        60_000,
      );

    if (!rateLimit.allowed) {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many requests. Please try again shortly.",
      );
    }

    const body =
      checkoutInitializeSchema.parse(
        await req.json(),
      );

    // Load database-backed checkout services only when a request is executing.
    reservationService = await import("@/lib/orders/stock-reservation");
    const { resolveCartLines } = await import("@/lib/orders/resolve-cart");

    // Preserve the existing fullName field in stored order/shipping data while
    // collecting first and last name separately in the storefront form.
    const shippingAddress = {
      ...body.shippingAddress,
      fullName:
        [body.shippingAddress.firstName, body.shippingAddress.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || body.shippingAddress.fullName || "",
    };

    /**
     * Opportunistic cleanup.
     *
     * Expired reservations are returned to available inventory before new
     * admission decisions are made.
     *
     * This is deliberately bounded so one checkout never performs an
     * unlimited cleanup job.
     */
    try {
      // Release a bounded batch before checking availability. If cleanup
      // cannot complete, fail closed rather than reject a customer because
      // expired reservations are still holding inventory.
      await reservationService.releaseExpiredCheckoutReservations(100);
    } catch (cleanupError) {
      console.error("Expired reservation cleanup failed; checkout admission stopped:", cleanupError);
      throw new ApiError(
        "SERVICE_UNAVAILABLE",
        "We’re refreshing stock availability. Please try checkout again shortly.",
      );
    }

    /**
     * Resolve the customer's cart before entering the admission gate.
     *
     * This validates product / variant identity and obtains authoritative
     * prices without trusting browser-supplied IDs or prices.
     */
    const resolved =
      await resolveCartLines(
        body.cart,
      );

    /**
     * PostgreSQL performs the real admission decision.
     *
     * Reservation:
     *
     * currentStock decreases
     * reservedStock increases
     *
     * Only requests that successfully reserve inventory continue.
     */
    try {
      const campaignIds = [...new Set(resolved.map((line) => line.offerCampaignId).filter((id): id is string => Boolean(id)))];
      const offerSetIds = [...new Set(resolved.map((line) => line.offerSetId).filter((id): id is string => Boolean(id)))];
      if (campaignIds.length > 1 || offerSetIds.length > 1) {
        throw new ApiError("VALIDATION_ERROR", "A checkout can use only one Offer Campaign and one Offer Set at a time.");
      }
      if (campaignIds.length !== offerSetIds.length) {
        throw new ApiError("VALIDATION_ERROR", "The selected offer is incomplete. Refresh the offer page and try again.");
      }
      const reservation =
        await reservationService.reserveStockForCheckout(
          resolved,
          campaignIds[0] ?? null,
          offerSetIds[0] ?? null,
          { email: body.email, name: shippingAddress.fullName },
        );

      reservationId =
        reservation.reservationId;
    } catch (error) {
      if (
        error instanceof
        reservationService.StockReservationUnavailableError
      ) {
        const { getCustomerCareWhatsApp } = await import("@/lib/config/customer-care");
        const customerCareWhatsApp =
          await getCustomerCareWhatsApp();

        throw new ApiError(
          "OUT_OF_STOCK",
          "Stock is not available. Contact Customer Care.",
          {
            customerCareWhatsApp,
          },
        );
      }

      throw error;
    }

    const amountNaira =
      resolved.reduce(
        (sum, line) =>
          sum +
          line.unitPrice *
            line.quantity,
        0,
      );

    const amountKobo =
      Math.round(
        amountNaira * 100,
      );

    // This checkout flow always uses Paystack. Do not send zero-value or
    // unsafe amounts to the provider; release the reservation in the catch
    // path below if the cart has no payable balance.
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Your cart total must be greater than zero to continue to payment.",
      );
    }

    const secretKey =
      process.env
        .PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error(
        "PAYSTACK_SECRET_KEY is not set - cannot initialize a transaction.",
      );

      throw new ApiError(
        "PAYMENT_INIT_FAILED",
        "Payment is temporarily unavailable. Please try again shortly.",
      );
    }

    const storefrontUrl =
      process.env.STOREFRONT_URL ??
      "https://www.giftijbrandy.com";

    /**
     * Only admitted customers reach Paystack.
     */
    const paystackRes =
      await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${secretKey}`,

            "Content-Type":
              "application/json",
          },

          // A provider timeout must release the reservation through the catch
          // path rather than leave a customer waiting on an open request.
          signal: AbortSignal.timeout(10_000),

          body: JSON.stringify({
            email:
              body.email,

            amount:
              amountKobo,

            currency:
              "NGN",

            callback_url:
              `${storefrontUrl}/checkout/callback`,

            metadata: {
              reservationId,
              offerCampaignId: resolved.find((line) => line.offerCampaignId)?.offerCampaignId ?? null,

              // Server-calculated amount in kobo; webhook uses this for verification.
              expectedAmountKobo: amountKobo,

              cart:
                resolved.map(
                  (line) => ({
                    productId:
                      line.productId,

                    variantId:
                      line.variantId,

                    quantity:
                      line.quantity,

                    // Immutable server-resolved unit price for order reconciliation.
                    unitPrice: line.unitPrice,
                    offerCampaignId: line.offerCampaignId,
                    offerSetId: line.offerSetId,
                  }),
                ),

              shippingAddress,
            },
          }),
        },
      );

    const paystackJson =
      (await paystackRes
        .json()
        .catch(() => null)) as
        | {
            status?: boolean;

            message?: string;

            data?: {
              authorization_url:
                string;

              access_code:
                string;

              reference:
                string;
            };
          }
        | null;

    if (
      !paystackRes.ok ||
      !paystackJson?.status ||
      !paystackJson.data ||
      typeof paystackJson.data.authorization_url !== "string" ||
      !paystackJson.data.authorization_url.startsWith("https://") ||
      typeof paystackJson.data.access_code !== "string" ||
      !paystackJson.data.access_code ||
      typeof paystackJson.data.reference !== "string" ||
      !paystackJson.data.reference
    ) {
      console.error(
        "Paystack initialize failed:",
        paystackRes.status,
        paystackJson,
      );

      throw new ApiError(
        "PAYMENT_INIT_FAILED",
        "We couldn't start your payment. Please try again in a moment.",
      );
    }

    await reservationService.attachPaymentReferenceToReservation(
      reservationId,
      paystackJson.data.reference,
    );

    reservationAttachedToPaystack =
      true;

    return withCors(
      ok({
        authorizationUrl:
          paystackJson.data
            .authorization_url,

        accessCode:
          paystackJson.data
            .access_code,

        reference:
          paystackJson.data
            .reference,
      }),

      origin,
    );
  } catch (error) {
    if (reservationService && error instanceof reservationService.OfferCampaignUnavailableError) {
      return withCors(fail(new ApiError("OFFER_UNAVAILABLE", "This offer has just ended or reached its qualifying-order limit. Please refresh the campaign page.")), origin);
    }
    /**
     * If inventory was claimed but a usable Paystack checkout was never
     * handed to the customer, immediately return that stock.
     */
    if (
      reservationId &&
      !reservationAttachedToPaystack
    ) {
      try {
        if (reservationService) {
          await reservationService.releaseCheckoutReservation(reservationId);
        }
      } catch (
        releaseError
      ) {
        console.error(
          "Failed to release checkout reservation after initialization error:",
          releaseError,
        );
      }
    }

    return withCors(
      fail(error),
      origin,
    );
  }
}

export async function OPTIONS(
  req: NextRequest,
) {
  return corsPreflight(
    req.headers.get(
      "origin",
    ),
  );
}