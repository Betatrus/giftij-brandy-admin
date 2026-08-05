/**
 * Common variant type presets shown in the admin's dropdown. This is a UI
 * convenience only — the database (`Product.variantType`) is a plain
 * string and accepts anything, including a custom value typed in when the
 * admin picks "Other". Adding a new preset here later is a one-line change,
 * never a migration.
 */
export const VARIANT_TYPE_PRESETS = ["Colour", "Size", "Material"] as const;

export const OTHER_VARIANT_TYPE = "Other" as const;
