/**
 * Giftij Brandy Admin — RBAC Permission Layer
 *
 * This is the single source of truth for what each role can see and do.
 * Two rules, non-negotiable:
 *  1. Every server action / route handler that touches money must call
 *     assertCanViewFinancials() or stripFinancialFields() before returning data.
 *  2. Sidebar/UI visibility is a convenience, NOT a security boundary —
 *     the backend check is what actually protects the data.
 *
 * Adding a role: extend StaffRole in prisma/schema.prisma, then add its
 * permission set below. Nothing else in the app should hardcode role checks.
 */

import { StaffRole } from "@prisma/client";

export const FINANCIAL_FIELDS = [
  "costPrice",
  "profit",
  "revenue",
  "grossProfit",
  "netProfit",
  "profitMargin",
] as const;

export type Permission =
  | "products:read"
  | "products:write"
  | "products:read:financials"
  | "inventory:read"
  | "inventory:write"
  | "orders:read"
  | "orders:write"
  | "orders:read:financials"
  | "customers:read"
  | "customers:write"
  | "communications:read"
  | "communications:write"
  | "analytics:read"
  | "analytics:read:financials"
  | "reports:read"
  | "reports:read:financials"
  | "settings:read"
  | "settings:write"
  | "staff:manage";

const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  SUPER_ADMIN: [
    "products:read", "products:write", "products:read:financials",
    "inventory:read", "inventory:write",
    "orders:read", "orders:write", "orders:read:financials",
    "customers:read", "customers:write",
    "communications:read", "communications:write",
    "analytics:read", "analytics:read:financials",
    "reports:read", "reports:read:financials",
    "settings:read", "settings:write", "staff:manage",
  ],
  TECHNICAL_SUPPORT: [
    "products:read", "products:write", "products:read:financials",
    "inventory:read", "inventory:write",
    "orders:read", "orders:write", "orders:read:financials",
    "customers:read", "customers:write",
    "communications:read", "communications:write",
    "analytics:read", "analytics:read:financials",
    "reports:read", "reports:read:financials",
    "settings:read", "settings:write", "staff:manage",
  ],
  SUPPORT_ADMIN: [
    "products:read", "products:write",
    "inventory:read", "inventory:write",
    "orders:read", "orders:write",
    "customers:read", "customers:write",
    "communications:read", "communications:write",
    "analytics:read", "reports:read",
  ],
};

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canViewFinancials(role: StaffRole): boolean {
  return role === "SUPER_ADMIN" || role === "TECHNICAL_SUPPORT";
}

/**
 * Throws if the role isn't allowed to view financial data.
 * Call this at the top of any server action / route handler before
 * querying or returning costPrice, profit, revenue, or margin data.
 */
export function assertCanViewFinancials(role: StaffRole): void {
  if (!canViewFinancials(role)) {
    throw new Error("FORBIDDEN: financial data requires Super Admin access");
  }
}

/**
 * Strips financial fields from a Product (or any object with those keys)
 * before it's sent to a Support Admin. Use this instead of trusting the
 * frontend to hide fields — the data must never leave the server.
 */
export function stripFinancialFields<T extends Record<string, unknown>>(
  record: T,
  role: StaffRole
): T {
  if (canViewFinancials(role)) return record;

  const clean = { ...record };
  for (const field of FINANCIAL_FIELDS) {
    if (field in clean) delete (clean as Record<string, unknown>)[field];
  }
  return clean;
}

export function stripFinancialFieldsFromList<T extends Record<string, unknown>>(
  records: T[],
  role: StaffRole
): T[] {
  return records.map((r) => stripFinancialFields(r, role));
}
