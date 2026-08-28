import { z } from "zod";

export const CUSTOMER_LIFECYCLES = ["NEW", "RETURNING"] as const;
export type CustomerLifecycle = (typeof CUSTOMER_LIFECYCLES)[number];

export const customerFiltersSchema = z.object({
  search: z.string().optional(), // name, email, or phone
  lifecycle: z.enum(CUSTOMER_LIFECYCLES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type CustomerFiltersInput = z.infer<typeof customerFiltersSchema>;
