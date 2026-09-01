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
// `sku` is optional here — the admin never types one; if left blank the
// server auto-generates it from the product SKU + variant value (see
// lib/actions/products.ts). Still required in the database (unique,
// non-null) — this is an input-side relaxation only.
export const variantSchema = z.object({
  id: z.string().optional(),
  value: z.string().min(1, "Variant value is required"),
  // Structured Color x Size fields (Phase 9) — set directly by the
  // Colour+Size builder when it already knows the color/size that make up
  // a combination, so the server never has to re-derive them by parsing
  // `value`. Optional/nullable: Bag (Colour-only) and generic/custom
  // variant types don't send these — the server infers color-only /
  // size-only from the product's variantType instead (see
  // lib/actions/products.ts), and Material/custom types correctly leave
  // both null.
  color: z.string().trim().min(1).optional().nullable(),
  size: z.string().trim().min(1).optional().nullable(),
  sku: z.string().optional().default(""),
  stock: z.coerce.number().int().min(0).default(0),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
  // Display-only — the already-uploaded Cloudinary URL for this exact
  // variant, when editing an existing product. Never sent anywhere by
  // the admin; carried through defaultValues purely so the edit form can
  // show what's already there (see the "existing variant images never
  // displayed" fix in components/admin/products/variants-section.tsx).
  // Always absent/undefined for a brand-new product.
  imageUrl: z.string().optional().nullable(),
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
    // Not shown in the form — the database still requires a short
    // description, so if left blank the server derives one from
    // `fullDesc` (see lib/actions/products.ts). Admins who want a
    // specific short description can still set one via `defaultValues`
    // carried over from an existing product; there's just no input for
    // typing a new one, per the "simple form" requirement.
    shortDesc: z.string().optional().default(""),
    fullDesc: z.string().min(1, "Description is required"),

    // Single-select in the UI (see CategorySelect) — still an array at
    // the schema/database level because Category is many-to-many.
    categoryIds: z.array(z.string()).min(1, "Select a category"),

    brand: z.string().default("Giftij Brandy"),
    // Not shown in the form — auto-generated server-side if blank (see
    // lib/actions/products.ts). Kept optional here, not removed, since
    // the database column is still required/unique.
    sku: z.string().optional().default(""),
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
  })
  // Phase 9 structured-data validation rule (master prompt §28): a
  // Colour + Size product's variants must each carry BOTH a color and a
  // size — never a bare combined string with nothing structured behind
  // it. Colour-only, Size-only, and Material/custom variantTypes aren't
  // constrained here since color/size are legitimately absent for those.
  .refine(
    (data) =>
      !data.hasVariants ||
      data.variantType !== "Colour + Size" ||
      data.variants.every((v) => !!v.color?.trim() && !!v.size?.trim()),
    {
      message: "Every Colour + Size variant needs both a color and a size.",
      path: ["variants"],
    }
  );

export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
export type SpecInput = z.infer<typeof specSchema>;
