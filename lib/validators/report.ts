import { z } from "zod";

/**
 * Shared by all four report types (Sales/Customers/Inventory/Financial —
 * §33). "Offline Sales" is deliberately not a separate report/page — it's
 * the Sales report with `saleSource: "OFFLINE"`, per the design note in
 * lib/reports/sales.ts. Every filter defaults to ALL (omitted/undefined),
 * matching "Reports can be ALL or filtered."
 */
export const reportFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  categoryId: z.string().optional(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  customerId: z.string().optional(),
  saleSource: z.enum(["ONLINE", "OFFLINE"]).optional(), // undefined = both
});

export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;

/** Hard cap on rows returned to the browser in one go — see the note in lib/reports/sales.ts on why this is a deliberate MVP simplification rather than server-side pagination. */
export const REPORT_ROW_CAP = 2000;
