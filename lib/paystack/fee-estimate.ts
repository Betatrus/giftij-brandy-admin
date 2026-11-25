/**
 * Display-only estimate of Paystack's published Nigerian local-payment fee.
 * All arithmetic is performed in kobo. This value must never be added to
 * the amount sent to Paystack: Paystack applies the actual fee at checkout.
 */
export function estimatePaystackLocalFeeKobo(productSubtotalKobo: number): number {
  if (!Number.isSafeInteger(productSubtotalKobo) || productSubtotalKobo <= 0) return 0;

  const percentageRate = 0.015;
  const flatFeeKobo = productSubtotalKobo >= 250_000 ? 10_000 : 0;
  const feeCapKobo = 200_000;
  const feeBeforeGrossUp = productSubtotalKobo * percentageRate + flatFeeKobo;

  if (feeBeforeGrossUp >= feeCapKobo) return feeCapKobo;

  // Round upward to the next kobo. Math.round(+1) overstates some
  // amounts by one kobo compared with Paystack's observed checkout totals.
  const grossAmountKobo =
    Math.ceil((productSubtotalKobo + flatFeeKobo) / (1 - percentageRate));

  return Math.min(Math.max(grossAmountKobo - productSubtotalKobo, 0), feeCapKobo);
}
