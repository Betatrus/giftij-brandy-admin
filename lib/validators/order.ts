import { z } from "zod";
import { ADMIN_ORDER_STATUSES } from "@/lib/utils/order-status";

export const orderFiltersSchema = z.object({
  search: z.string().optional(), // order number, customer name/email
  categoryId: z.string().optional(),
  status: z.enum(ADMIN_ORDER_STATUSES).optional(),
  dateFrom: z.string().optional(), // ISO date
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type OrderFiltersInput = z.infer<typeof orderFiltersSchema>;

export const addOrderNoteSchema = z.object({
  orderId: z.string().min(1),
  note: z.string().min(1, "Note cannot be empty"),
});
