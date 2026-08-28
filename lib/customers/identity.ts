import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * ONE CUSTOMER -> MANY ORDERS identity resolution. Email is the anchor —
 * it's the only unique-constrained identifying field on Customer (see
 * prisma/schema.prisma). Phone and name are captured/updated as
 * supplementary detail but never used as the match key on their own:
 * matching on name alone is unreliable (two "Ada Okafor"s are not
 * necessarily the same person), and phone has no unique constraint to
 * safely match against. This intentionally means two different email
 * addresses for the same real person still produce two Customer rows —
 * a known MVP limitation, not a bug; a fuzzier identity-merge system is
 * a deliberate future enhancement, not something to guess at here.
 *
 * `address`/`country` are kept up to date with the MOST RECENT order's
 * delivery details (never overwritten with something blank) — a
 * customer's own "location" on file is genuinely their latest known
 * delivery address, useful for admin follow-up via email/WhatsApp,
 * matching what's now surfaced on the Customers page and its CSV export.
 * `Customer.address`/`Customer.country` already existed in the schema
 * before this — they were just never being written to until now; no
 * schema change involved.
 *
 * Not a Server Action (no "use server", no requireSession/permission
 * check) — this is an internal data helper called both by admin Server
 * Actions (which enforce their own auth before calling it) and by the
 * unauthenticated Paystack webhook route, which can never carry an admin
 * session.
 */
export async function findOrCreateCustomerByEmail(input: {
  email: string;
  name: string;
  phone?: string | null;
  address?: Prisma.InputJsonValue | null;
  country?: string | null;
}) {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.customer.findUnique({ where: { email } });
  if (existing) {
    const data: Prisma.CustomerUpdateInput = {};
    // Backfill phone if we now have one and didn't before; never
    // overwrite a name the admin may have since corrected by hand with
    // whatever string happened to arrive on this particular order.
    if (input.phone && !existing.phone) data.phone = input.phone;
    // Address/country DO get refreshed on every order, unlike phone —
    // a delivery address is naturally the MOST RECENT one, not the
    // first one ever seen, so this intentionally overwrites rather than
    // only-backfills. Never overwrites with an empty/missing value.
    if (input.address) data.address = input.address;
    if (input.country) data.country = input.country;

    if (Object.keys(data).length === 0) return existing;
    return prisma.customer.update({ where: { id: existing.id }, data });
  }

  return prisma.customer.create({
    data: {
      email,
      name: input.name,
      phone: input.phone ?? null,
      address: input.address ?? undefined,
      country: input.country ?? null,
    },
  });
}

/** Appends a CustomerEvent — the generic lifecycle-touchpoint log referenced by the Customer model's comment in prisma/schema.prisma. */
export async function recordCustomerEvent(
  customerId: string,
  label: string,
  metadata?: Prisma.InputJsonValue
) {
  await prisma.customerEvent.create({
    data: { customerId, label, metadata },
  });
}
