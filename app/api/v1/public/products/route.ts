import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  ok,
  fail,
  type PaginationMeta,
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
import { productListQuerySchema } from "@/lib/validators/public/products";
import { featuredFlagsProvider } from "@/lib/collections/featured-flags-provider";
import {
  getPagination,
  getPageCount,
} from "@/lib/utils/pagination";
import {
  PUBLIC_PRODUCT_SUMMARY_SELECT,
  toProductSummaryDTO,
} from "@/lib/api/public-product-select";
import type { Prisma } from "@prisma/client";

const SORT_MAP: Record<
  string,
  Prisma.ProductOrderByWithRelationInput
> = {
  newest: { createdAt: "desc" },
  price_asc: { price: "asc" },
  price_desc: { price: "desc" },
  name_asc: { name: "asc" },
};

/**
 * Cached query, tagged "products".
 *
 * Every mutating product/inventory Server Action calls
 * revalidateTag("products") on commit, so this remains effectively
 * real-time while still giving repeated identical requests a cache hit.
 *
 * Cache key v2 contains the variant-image-aware public DTO.
 */
const getCachedProductList = unstable_cache(
  async (query: {
    q?: string;
    category?: string;
    featured?: string;
    sort: string;
    page: number;
    pageSize: number;
  }) => {
    const {
      skip,
      take,
      page,
      pageSize,
    } = getPagination(
      query.page,
      query.pageSize
    );

    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",

      ...(query.q
        ? {
            OR: [
              {
                name: {
                  contains: query.q,
                  mode: "insensitive",
                },
              },
              {
                sku: {
                  contains: query.q,
                  mode: "insensitive",
                },
              },
              {
                shortDesc: {
                  contains: query.q,
                  mode: "insensitive",
                },
              },
              {
                tags: {
                  hasSome: [query.q],
                },
              },
            ],
          }
        : {}),

      ...(query.category
        ? {
            categories: {
              some: {
                slug: query.category,
              },
            },
          }
        : {}),

      ...(query.featured
        ? featuredFlagsProvider.whereClauseForFlag(
            query.featured as Parameters<
              typeof featuredFlagsProvider.whereClauseForFlag
            >[0]
          )
        : {}),
    };

    const [rows, total] =
      await Promise.all([
        prisma.product.findMany({
          where,
          select:
            PUBLIC_PRODUCT_SUMMARY_SELECT,
          orderBy:
            SORT_MAP[query.sort] ??
            SORT_MAP.newest,
          skip,
          take,
        }),

        prisma.product.count({
          where,
        }),
      ]);

    return {
      items: rows.map(
        toProductSummaryDTO
      ),

      meta: {
        page,
        pageSize,
        total,
        pageCount:
          getPageCount(
            total,
            pageSize
          ),
      } satisfies PaginationMeta,
    };
  },

  ["public-product-list-v2"],

  {
    tags: ["products"],
    revalidate: 60,
  }
);

export async function GET(
  req: NextRequest
) {
  const origin =
    req.headers.get("origin");

  /*
   * Product catalogue access is server-to-server only.
   *
   * The storefront Next.js server sends X-Storefront-Key.
   * Direct anonymous requests do not receive catalogue JSON.
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
        `public:products:${ip}`,
        120,
        60_000
      );

    if (!rateLimit.allowed) {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many requests. Please try again shortly."
      );
    }

    const query =
      productListQuerySchema.parse(
        Object.fromEntries(
          req.nextUrl.searchParams
        )
      );

    const {
      items,
      meta,
    } =
      await getCachedProductList(
        query
      );

    return withCors(
      ok(items, meta),
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