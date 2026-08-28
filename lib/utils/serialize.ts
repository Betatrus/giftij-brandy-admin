import type { Decimal } from "@prisma/client/runtime/library";

function toNum(value: Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value.toString());
}

/**
 * Converts a Product record's Decimal fields (price, costPrice, discount)
 * to plain numbers so it can be passed from a Server Component/Action to
 * a Client Component. Run this AFTER stripFinancialFields() when the
 * caller is a Support Admin, so costPrice is simply absent rather than 0.
 */
export function serializeProduct<T extends Record<string, unknown>>(product: T) {
  return {
    ...product,
    price: "price" in product ? toNum(product.price as Decimal) : undefined,
    costPrice: "costPrice" in product ? toNum(product.costPrice as Decimal) : undefined,
    discount: "discount" in product ? toNum(product.discount as Decimal | null) : undefined,
    // No variant.price mapping — variants no longer carry a price field;
    // every variant shares the base product's price.
  };
}

export function serializeProducts<T extends Record<string, unknown>>(products: T[]) {
  return products.map(serializeProduct);
}

/**
 * Same idea as serializeProduct, for an Order's Decimal fields (subtotal,
 * profit) and its items' unitPrice. Run AFTER stripFinancialFields() so
 * `profit` is simply absent for a Support Admin rather than serialized
 * to 0 (which would look like a real, deliberate zero-profit order).
 */
export function serializeOrder<T extends Record<string, unknown>>(order: T) {
  const items = Array.isArray(order.items)
    ? (order.items as Record<string, unknown>[]).map((item) => ({
        ...item,
        unitPrice: "unitPrice" in item ? toNum(item.unitPrice as Decimal) : undefined,
      }))
    : order.items;

  return {
    ...order,
    subtotal: "subtotal" in order ? toNum(order.subtotal as Decimal) : undefined,
    profit: "profit" in order ? toNum(order.profit as Decimal | null) : undefined,
    items,
  };
}
