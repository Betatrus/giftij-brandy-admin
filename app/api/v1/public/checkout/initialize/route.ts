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
import { resolveCartLines } from "@/lib/orders/resolve-cart";
import {
  attachPaymentReferenceToReservation,
  releaseCheckoutReservation,
  releaseExpiredCheckoutReservations,
  reserveStockForCheckout,
  StockReservationUnavailableError,
} from "@/lib/orders/stock-reservation";
import { getCustomerCareWhatsApp } from "@/lib/config/customer-care";

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

  try {
    const ip =
      getClientIp(req);

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

    // Preserve the existing fullName field in stored order/shipping data while
    // collecting first and last name separately in the storefront form.
    const shippingAddress = {
      ...body.shippingAddress,
      fullName: `${body.shippingAddress.firstName} ${body.shippingAddress.lastName}`.trim(),
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
      await releaseExpiredCheckoutReservations(
        25,
      );
    } catch (
      cleanupError
    ) {
      console.error(
        "Expired reservation cleanup failed:",
        cleanupError,
      );

      /**
       * Do not block a legitimate checkout merely because cleanup failed.
       * PostgreSQL reservation rules still protect current inventory.
       */
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
      const reservation =
        await reserveStockForCheckout(
          resolved,
        );

      reservationId =
        reservation.reservationId;
    } catch (error) {
      if (
        error instanceof
        StockReservationUnavailableError
      ) {
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
      !paystackJson.data
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

    await attachPaymentReferenceToReservation(
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
    /**
     * If inventory was claimed but a usable Paystack checkout was never
     * handed to the customer, immediately return that stock.
     */
    if (
      reservationId &&
      !reservationAttachedToPaystack
    ) {
      try {
        await releaseCheckoutReservation(
          reservationId,
        );
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