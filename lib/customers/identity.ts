import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * ONE CUSTOMER -> MANY ORDERS identity resolution.
 *
 * Email remains the primary identity anchor because Customer.email is
 * uniquely constrained in the current schema.
 *
 * Name and phone are customer profile information, not independent match
 * keys. This prevents two unrelated people with the same name from being
 * incorrectly merged.
 *
 * Customer delivery address/country represent the customer's most recent
 * known delivery details.
 */
export async function findOrCreateCustomerByEmail(input: {
  email: string;
  name: string;
  phone?: string | null;
  address?: Prisma.InputJsonValue | null;
  country?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const incomingName = input.name.trim();
  const incomingPhone = input.phone?.trim() || null;

  const existing = await prisma.customer.findUnique({
    where: { email },
  });

  if (existing) {
    const data: Prisma.CustomerUpdateInput = {};

    /**
     * Do not overwrite a legitimate/admin-corrected name on every order.
     *
     * However, older Paystack-created customer records may contain their
     * email address in the name field because the webhook previously used
     * email as the fallback when Paystack supplied no first/last name.
     *
     * Those records are safe to repair automatically when checkout now
     * provides a real full name.
     */
    const existingName = existing.name?.trim() ?? "";
    const existingNameIsEmail =
      existingName.toLowerCase() === existing.email.trim().toLowerCase();

    if (
      incomingName &&
      incomingName.toLowerCase() !== email &&
      (!existingName || existingNameIsEmail)
    ) {
      data.name = incomingName;
    }

    /**
     * Backfill phone when the customer record doesn't already have one.
     *
     * We deliberately avoid overwriting an existing phone automatically
     * because the admin may have corrected it manually.
     */
    if (incomingPhone && !existing.phone) {
      data.phone = incomingPhone;
    }

    /**
     * Delivery address is intentionally refreshed on successful orders.
     * This represents the customer's most recent known delivery location.
     */
    if (input.address) {
      data.address = input.address;
    }

    if (input.country) {
      data.country = input.country;
    }

    if (Object.keys(data).length === 0) {
      return existing;
    }

    return prisma.customer.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.customer.create({
    data: {
      email,
      name: incomingName || email,
      phone: incomingPhone,
      address: input.address ?? undefined,
      country: input.country ?? null,
    },
  });
}

/**
 * Appends a generic customer lifecycle/touchpoint event.
 */
export async function recordCustomerEvent(
  customerId: string,
  label: string,
  metadata?: Prisma.InputJsonValue
) {
  await prisma.customerEvent.create({
    data: {
      customerId,
      label,
      metadata,
    },
  });
}