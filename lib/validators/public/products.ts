import { z } from "zod";
import { FEATURED_FLAG_OPTIONS } from "@/lib/collections/featured-flags-provider";

export const productSortOptions = ["newest", "price_asc", "price_desc", "name_asc"] as const;

export const productListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  category: z.string().optional(), // category slug
  featured: z.enum(FEATURED_FLAG_OPTIONS).optional(),
  sort: z.enum(productSortOptions).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productSlugParamSchema = z.object({
  slug: z.string().min(1),
});
