/**
 * Single source of truth for the Customer Care WhatsApp number. Backed by
 * the singleton StoreSettings row (see prisma/schema.prisma) rather than
 * an env var, since an admin must be able to set/edit it from Settings —
 * see lib/actions/settings.ts for the write side. Nothing in this admin
 * repository currently sends the customer-facing message itself (there
 * is no checkout/storefront code here — see the Paystack webhook's
 * documented ASSUMED PAYLOAD CONTRACT for why), but this gives the
 * storefront a real, single, DB-backed home for the number whenever it
 * needs it.
 */
import { getStoreSettings } from "@/lib/actions/settings";

export async function getCustomerCareWhatsApp(): Promise<string | null> {
  const settings = await getStoreSettings();
  return settings.customerCareWhatsApp?.trim() || null;
}

/** A ready-to-use wa.me link, or null if not configured. */
export async function getCustomerCareWhatsAppLink(): Promise<string | null> {
  const number = await getCustomerCareWhatsApp();
  return number ? `https://wa.me/${number}` : null;
}
