/**
 * Product.discount is a PERCENTAGE (Decimal(5,2) — see prisma/schema.prisma),
 * not a flat amount — e.g. a ₦5,000 discount off an ₦80,000 item is stored
 * as `6.25`. This is the ONE place that percentage is turned into an actual
 * naira amount off the listed price, so every caller (the Paystack webhook,
 * the public product API) computes the exact same number the exact same way.
 *
 * Rounded to 2 decimal places, matching every Decimal(_, 2) price column in
 * the schema.
 */
export function computeEffectivePrice(price: number, discountPercent: number | null | undefined): number {
  const pct = discountPercent ?? 0;
  const effective = price * (1 - pct / 100);
  return Math.round(effective * 100) / 100;
}

export function computeDiscountAmount(price: number, discountPercent: number | null | undefined): number {
  return Math.round((price - computeEffectivePrice(price, discountPercent)) * 100) / 100;
}
