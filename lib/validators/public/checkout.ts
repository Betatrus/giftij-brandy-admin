import { z } from "zod";

/**
 * One cart line as sent by the storefront. The storefront never sends a
 * Prisma id directly — it only knows `productSlug` (from the public
 * product API) and, for variant products, the variant's `sku` (also from
 * the public product API). This endpoint is the ONLY place those get
 * resolved into real productId/variantId values, from the database, never
 * trusted from the client.
 */
export const checkoutCartLineSchema = z.object({
  productSlug: z.string().min(1),
  // Present for variant products (colour and/or colour+size), absent for
  // simple non-variant products.
  sku: z.string().min(1).optional(),
  offerCampaignSlug: z.string().min(1).max(90).optional(),
  offerSetId: z.string().min(1).max(80).optional(),
  quantity: z.coerce.number().int().min(1).max(50),
});

export const checkoutInitializeSchema = z.object({
  email: z.string().email(),
  cart: z.array(checkoutCartLineSchema).min(1).max(50),
  // Free-form, JSON-serializable — stored as-is on Customer.address and
  // Order.shippingAddress, same as the Paystack webhook already expects.
  shippingAddress: z.object({
    // New storefronts send separate names; retain fullName for compatibility
    // with older Preview clients until every preview build has rolled forward.
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    fullName: z.string().trim().min(1).optional(),
    phone: z.string().min(1),
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().optional(),
    country: z.string().min(1),
  }).refine(
    (address) => Boolean(address.fullName || (address.firstName && address.lastName)),
    { message: "Enter your first and last name.", path: ["firstName"] },
  ),
});

export type CheckoutInitializeInput = z.infer<typeof checkoutInitializeSchema>;

export const orderStatusQuerySchema = z.object({
  reference: z.string().min(1),
});
