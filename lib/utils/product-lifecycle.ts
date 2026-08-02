import type { ProductStatus } from "@prisma/client";

/**
 * Explicit product lifecycle. DRAFT -> ACTIVE -> ARCHIVED is the forward
 * path; ARCHIVED can be reactivated back to ACTIVE or reverted to DRAFT
 * (undo). No other role gets to define its own notion of "valid status" —
 * every status change in the app goes through this.
 */
const ALLOWED_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: ["ACTIVE", "DRAFT"],
};

export function isValidProductTransition(from: ProductStatus, to: ProductStatus): boolean {
  if (from === to) return true; // saving without changing status is always fine
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidProductTransition(from: ProductStatus, to: ProductStatus): void {
  if (!isValidProductTransition(from, to)) {
    throw new Error(
      `Invalid product status transition: ${from} → ${to}. Allowed from ${from}: ${ALLOWED_TRANSITIONS[from].join(", ") || "(none)"}.`
    );
  }
}
