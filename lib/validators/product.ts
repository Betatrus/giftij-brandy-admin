import { z } from "zod";
import { FEATURED_FLAG_OPTIONS } from "@/lib/collections/featured-flags-provider";

export { FEATURED_FLAG_OPTIONS };

export const specSchema = z.object({
  id: z.string().optional(), // present when editing an existing spec row
  label: z.string().min(1, "Label is required"),
  value: z.string().min(1, "Value is required"),
});

export const variantSchema = z.object({
  id: z.string().optional(),
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  pattern: z.string().optional().nullable(),
  sku: z.string().min(1, "Variant SKU is required"),
  price: z.coerce.number().min(0).optional().nullable(),
  stock: z.coerce.number().int().min(0).default(0),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
});

export const productSchema = z.object({
  name: z.string().min(2, "Name is required"),
  // Optional manual override — if blank, the server generates one from
  // `name` via lib/utils/slug.ts. Editable afterward for SEO purposes.
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase, hyphenated, no spaces")
    .optional()
    .nullable(),
  shortDesc: z.string().min(1, "Short description is required").max(200),
  fullDesc: z.string().min(1, "Full description is required"),
  categoryId: z.string().min(1, "Category is required"),
  brand: z.string().default("Giftij Brandy"),
  sku: z.string().min(1, "SKU is required"),
  barcode: z.string().optional().nullable(),

  price: z.coerce.number().min(0, "Price must be 0 or more"),
  costPrice: z.coerce.number().min(0, "Cost price must be 0 or more"),
  discount: z.coerce.number().min(0).max(100).optional().nullable(),

  currency: z.string().default("NGN"),
  weight: z.coerce.number().min(0).optional().nullable(),
  dimensions: z.string().optional().nullable(),
  warranty: z.string().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  tags: z.array(z.string()).default([]),
  featuredFlags: z.array(z.enum(FEATURED_FLAG_OPTIONS)).default([]),

  specs: z.array(specSchema).default([]),
  variants: z.array(variantSchema).default([]),

  // Only meaningful on create — sets the starting Inventory row.
  initialStock: z.coerce.number().int().min(0).default(0),
});

export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
export type SpecInput = z.infer<typeof specSchema>;

// Support Admin submits the same form but must never be able to set
// costPrice via a tampered request — server action re-checks this,
// this schema variant is used for client-side validation only.
export const productSchemaNoFinancials = productSchema.omit({ costPrice: true });
