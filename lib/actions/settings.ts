"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Gated the same way the Settings page already gates this section
// (`isSuperAdmin` in app/admin/settings/page.tsx) rather than adding a
// new permission key to lib/permissions.ts — this is the one place in
// the app that needs this check, so a dedicated permission would be
// more machinery than the feature warrants right now.
async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (session.user.role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN: only Super Admin can change store settings");
  }
  return session;
}

/**
 * Reads the singleton StoreSettings row, creating it (with all-null
 * optional fields) on first access rather than requiring a separate
 * seed step. Safe to call from anywhere, not just admin-gated code —
 * mirrors getCustomerCareWhatsApp's old "just returns a value" shape.
 */
export async function getStoreSettings() {
  return prisma.storeSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

export async function updateCustomerCareWhatsApp(rawNumber: string): Promise<void> {
  await requireSuperAdmin();

  // Store digits only (with an optional leading +), same shape
  // getCustomerCareWhatsAppLink() already expects when building a
  // wa.me link — no formatting/hardcoded number, whatever the admin
  // enters (minus stray spaces/dashes/parentheses) is what gets saved.
  const trimmed = rawNumber.trim();
  const normalized = trimmed ? trimmed.replace(/[^\d+]/g, "") : null;

  if (normalized && normalized.replace(/^\+/, "").length < 7) {
    throw new Error("That doesn't look like a valid WhatsApp number.");
  }

  await prisma.storeSettings.upsert({
    where: { id: "singleton" },
    update: { customerCareWhatsApp: normalized },
    create: { id: "singleton", customerCareWhatsApp: normalized },
  });

  revalidatePath("/admin/settings");
}


export async function updateStorefrontCheckoutLock(input: { locked: boolean; message: string }): Promise<void> {
  await requireSuperAdmin();

  if (typeof input.locked !== "boolean") {
    throw new Error("Invalid storefront lock setting.");
  }

  const message = input.message.trim();
  if (message.length > 1000) {
    throw new Error("The customer message must be 1,000 characters or fewer.");
  }
  if (input.locked && !message) {
    throw new Error("Add a customer-facing message before locking checkout.");
  }

  await prisma.storeSettings.upsert({
    where: { id: "singleton" },
    update: { checkoutLocked: input.locked, checkoutLockMessage: message || null },
    create: { id: "singleton", checkoutLocked: input.locked, checkoutLockMessage: message || null },
  });

  revalidatePath("/admin/settings");
}
