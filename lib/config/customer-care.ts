/**
 * Single source of truth for the Customer Care WhatsApp number — per the
 * confirmed requirement, this must come from configuration, never be
 * hardcoded inline wherever a low/out-of-stock message is shown. Nothing
 * in this admin repository currently sends that customer-facing message
 * (there is no checkout/storefront code here — see the Paystack webhook's
 * documented ASSUMED PAYLOAD CONTRACT for why), but the Settings page
 * reads and displays this value now so it has a real, single home ready
 * for whenever the storefront needs it.
 */
export function getCustomerCareWhatsApp(): string | null {
  return process.env.CUSTOMER_CARE_WHATSAPP?.trim() || null;
}

/** A ready-to-use wa.me link, or null if not configured. */
export function getCustomerCareWhatsAppLink(): string | null {
  const number = getCustomerCareWhatsApp();
  return number ? `https://wa.me/${number}` : null;
}
