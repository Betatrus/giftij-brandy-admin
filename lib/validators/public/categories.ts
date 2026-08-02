import { z } from "zod";

export const categoryListQuerySchema = z.object({
  flat: z.coerce.boolean().default(false),
});

export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
