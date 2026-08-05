import { z } from "zod";
import { FEATURED_FLAG_OPTIONS } from "@/lib/collections/featured-flags-provider";

export { FEATURED_FLAG_OPTIONS };

export const specSchema = z.object({
  id: z.string().optional(), // present when editing an existing spec row
  label: z.string().min(1, "Label is required"),
  value: z.string().min(1, "Value is required"),
});

// No color/size/material/pattern/price fields — `value` is generic (its
// meaning comes from the parent Product's `variantType`), and price is
// never per-variant: all variants of a product share Product.price.
export const variantSchema = z.object({
  id: z.string().optional(),
  value: z.string().min(1, "Variant value is required"),
  sku: z.string().min(1, "Variant SKU is required"),
  stock: z.coerce.number().int().min(0).default(0),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
});

export const productSchema = z
  .object({
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

    // Many-to-many — a product can belong to more than one category.
    categoryIds: z.array(z.string()).min(1, "Select at least one category"),

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

    // ── Variants (admin-defined type, not hardcoded) ──────────────────
    hasVariants: z.boolean().default(false),
    // Free text — could be a preset ("Colour", "Size", "Material") or a
    // custom value typed in when the admin picks "Other" in the UI. The
    // server never validates this against a fixed list; the dropdown is
    // a UI convenience only (see lib/constants/variant-types.ts).
    variantType: z.string().min(1).optional().nullable(),
    variants: z.array(variantSchema).default([]),

    // Only meaningful on create, and only when hasVariants is false —
    // sets the starting base Inventory row.
    initialStock: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (data) => !data.hasVariants || (!!data.variantType && data.variants.length > 0),
    {
      message: "Select a variant type and add at least one variant value.",
      path: ["variants"],
    }
  )
  .refine((data) => data.hasVariants || data.variants.length === 0, {
    message: "Variants were added but 'Has Variants' is off — turn it on, or remove the variants.",
    path: ["hasVariants"],
  });

export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
export type SpecInput = z.infer<typeof specSchema>;
