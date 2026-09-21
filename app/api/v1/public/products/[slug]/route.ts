import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
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
import {
  hasValidStorefrontKey,
  storefrontUnauthorizedResponse,
} from "@/lib/api/storefront-auth";
import { productSlugParamSchema } from "@/lib/validators/public/products";
import {
  PUBLIC_PRODUCT_DETAIL_SELECT,
  toProductDetailDTO,
} from "@/lib/api/public-product-select";

const getCachedProduct =
  unstable_cache(
    async (
      slug: string
    ) => {
      /*
       * Deliberately findFirst + explicit ACTIVE status rather than
       * findUnique on slug alone.
       *
       * A DRAFT/ARCHIVED product must behave exactly like a nonexistent
       * product and must never reveal that it exists.
       */
      const row =
        await prisma.product.findFirst({
          where: {
            slug,
            status: "ACTIVE",
          },

          select:
            PUBLIC_PRODUCT_DETAIL_SELECT,
        });

      return row
        ? toProductDetailDTO(row)
        : null;
    },

    ["public-product-detail"],

    {
      tags: ["products"],
      revalidate: 60,
    }
  );

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{
      slug: string;
    }>;
  }
) {
  const origin =
    req.headers.get("origin");

  /*
   * Product catalogue access is server-to-server only.
   */
  if (
    !hasValidStorefrontKey(req)
  ) {
    return withCors(
      storefrontUnauthorizedResponse(),
      origin
    );
  }

  try {
    const ip =
      getClientIp(req);

    const rateLimit =
      checkRateLimit(
        `public:product-detail:${ip}`,
        120,
        60_000
      );

    if (!rateLimit.allowed) {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many requests. Please try again shortly."
      );
    }

    const { slug } =
      productSlugParamSchema.parse(
        await context.params
      );

    const product =
      await getCachedProduct(
        slug
      );

    if (!product) {
      throw new ApiError(
        "NOT_FOUND",
        "Product not found"
      );
    }

    return withCors(
      ok(product),
      origin
    );
  } catch (error) {
    return withCors(
      fail(error),
      origin
    );
  }
}

export async function OPTIONS(
  req: NextRequest
) {
  return corsPreflight(
    req.headers.get("origin")
  );
}