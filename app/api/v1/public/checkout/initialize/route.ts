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
  checkStockAvailability,
  type UnavailableStockLine,
} from "@/lib/orders/stock";
import { getCustomerCareWhatsApp } from "@/lib/config/customer-care";

/**
 * Starts a purchase.
 *
 * The storefront never talks directly to Paystack's API and never receives
 * PAYSTACK_SECRET_KEY.
 *
 * Flow:
 *
 * 1. Validate the checkout request.
 * 2. Resolve productSlug/SKU against the Giftij database.
 * 3. Check live stock for every requested cart line.
 * 4. If any requested quantity cannot be fulfilled:
 *    - stop checkout,
 *    - do not initialize Paystack,
 *    - return exact requested/available quantities,
 *    - include customer-care WhatsApp.
 * 5. Calculate the authoritative order value from database prices.
 * 6. Initialize Paystack.
 * 7. Paystack webhook creates the actual Order only after successful payment.
 *
 * This endpoint deliberately does NOT create an Order.
 */

function formatStockIssue(
  item: UnavailableStockLine,
): string {
  if (item.available <= 0) {
    return `${item.name} is currently out of stock.`;
  }

  const unitLabel =
    item.available === 1
      ? "unit is"
      : "units are";

  return `Only ${item.available} ${unitLabel} currently available for ${item.name}. You requested ${item.requested}.`;
}

function buildStockMessage(
  unavailable: UnavailableStockLine[],
): string {
  const stockIssues =
    unavailable
      .map(formatStockIssue)
      .join(" ");

  return `${stockIssues} Please update your cart before continuing to payment.`;
}

export async function POST(
  req: NextRequest,
) {
  const origin =
    req.headers.get("origin");

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

    /**
     * Never trust price, product ID or variant ID supplied by the browser.
     *
     * Resolve the storefront's productSlug/SKU against the database first.
     */
    const resolved =
      await resolveCartLines(
        body.cart,
      );

    /**
     * Live inventory check immediately before Paystack initialization.
     */
    const unavailable =
      await checkStockAvailability(
        resolved,
      );

    if (
      unavailable.length > 0
    ) {
      const customerCareWhatsApp =
        await getCustomerCareWhatsApp();

      throw new ApiError(
        "OUT_OF_STOCK",
        buildStockMessage(
          unavailable,
        ),
        {
          unavailableItems:
            unavailable,
          customerCareWhatsApp,
        },
      );
    }

    /**
     * All requested quantities are available at this moment.
     *
     * Calculate the payment amount exclusively from current database prices.
     */
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
      "https://www.giftij.com";

    /**
     * Paystack is contacted only after stock has passed.
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

          body: JSON.stringify(
            {
              email:
                body.email,

              amount:
                amountKobo,

              currency:
                "NGN",

              callback_url:
                `${storefrontUrl}/checkout/callback`,

              /**
               * Keep the metadata contract expected by the webhook.
               */
              metadata: {
                cart:
                  resolved.map(
                    (line) => ({
                      productId:
                        line.productId,

                      variantId:
                        line.variantId,

                      quantity:
                        line.quantity,
                    }),
                  ),

                shippingAddress:
                  body.shippingAddress,
              },
            },
          ),
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
              authorization_url: string;
              access_code: string;
              reference: string;
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