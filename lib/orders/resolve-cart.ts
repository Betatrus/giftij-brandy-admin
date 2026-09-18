import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api/api-error";
import { computeEffectivePrice } from "@/lib/pricing/effective-price";
import type { CartLine } from "@/lib/orders/stock";

export interface ResolvedCartLine extends CartLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number; // authoritative, server-computed — never trust a client-sent price
  name: string;
}

/**
 * Turns the storefront's `{ productSlug, sku?, quantity }[]` cart shape
 * into the `{ productId, variantId, quantity }[]` shape the rest of the
 * order pipeline (checkStockAvailability, deductStockForOrder, the
 * Paystack webhook) already works with — and, in the same pass, looks up
 * the CURRENT price/discount so the amount charged is always the
 * database's price at checkout time, never whatever the client claims.
 *
 * Throws ApiError("NOT_FOUND" | "OUT_OF_STOCK" | "VALIDATION_ERROR") for
 * anything that doesn't resolve cleanly — a deleted/archived product, a
 * sku that doesn't belong to the given product, etc. — so a bad or stale
 * cart line is rejected before any payment is ever initiated.
 */
export async function resolveCartLines(
  cart: { productSlug: string; sku?: string; quantity: number }[]
): Promise<ResolvedCartLine[]> {
  const slugs = [...new Set(cart.map((l) => l.productSlug))];

  const products = await prisma.product.findMany({
    where: { slug: { in: slugs }, status: "ACTIVE" },
    select: {
      id: true,
      slug: true,
      name: true,
      price: true,
      discount: true,
      variants: { select: { id: true, sku: true, status: true } },
    },
  });
  const productBySlug = new Map(products.map((p) => [p.slug, p]));

  return cart.map((line) => {
    const product = productBySlug.get(line.productSlug);
    if (!product) {
      throw new ApiError("NOT_FOUND", `Product "${line.productSlug}" is no longer available.`);
    }

    const unitPrice = computeEffectivePrice(
      Number(product.price),
      product.discount ? Number(product.discount) : 0
    );

    if (line.sku) {
      const variant = product.variants.find((v) => v.sku === line.sku);
      if (!variant || variant.status === "ARCHIVED") {
        throw new ApiError(
          "NOT_FOUND",
          `The selected option for "${product.name}" is no longer available.`
        );
      }
      return {
        productId: product.id,
        variantId: variant.id,
        quantity: line.quantity,
        unitPrice,
        name: product.name,
      };
    }

    if (product.variants.length > 0) {
      // A variant product with no sku sent — the client dropped which
      // colour/size was selected. Never guess; reject explicitly.
      throw new ApiError(
        "VALIDATION_ERROR",
        `"${product.name}" requires a selected option (colour/size).`
      );
    }

    return {
      productId: product.id,
      variantId: null,
      quantity: line.quantity,
      unitPrice,
      name: product.name,
    };
  });
}
