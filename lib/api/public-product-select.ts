import type { Prisma } from "@prisma/client";

/**
 * These select clauses are the enforcement point for "financial fields are
 * never exposed publicly" — costPrice simply isn't in either list below,
 * so there is no code path by which a public response could include it,
 * regardless of what happens elsewhere in the app.
 */

export const PUBLIC_PRODUCT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortDesc: true,
  price: true,
  discount: true,
  currency: true,
  featuredFlags: true,
  categories: { select: { name: true, slug: true } },
  images: {
    select: { url: true, imageType: true },
    orderBy: { sortOrder: "asc" as const },
  },
  inventory: { select: { currentStock: true } },
  variants: { select: { id: true, currentStock: true } },
} satisfies Prisma.ProductSelect;

export const PUBLIC_PRODUCT_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortDesc: true,
  fullDesc: true,
  brand: true,
  price: true,
  discount: true,
  currency: true,
  weight: true,
  dimensions: true,
  warranty: true,
  tags: true,
  featuredFlags: true,
  seoTitle: true,
  seoDescription: true,
  variantType: true,
  categories: { select: { name: true, slug: true } },
  images: {
    select: { url: true, altText: true, width: true, height: true, format: true, sortOrder: true },
    orderBy: { sortOrder: "asc" as const },
  },
  specs: { select: { label: true, value: true } },
  variants: {
    select: {
      id: true,
      sku: true,
      value: true,
      currentStock: true,
      status: true,
      image: { select: { url: true, altText: true } },
    },
  },
  inventory: { select: { currentStock: true } },
} satisfies Prisma.ProductSelect;

// Explicit shapes mirroring the select clauses above, used as the DTO
// functions' actual parameter types below. Prisma.ProductGetPayload would
// normally do this inference automatically, but it can't resolve until
// `prisma generate` has run — these keep the DTO functions fully typed
// (no implicit `any`) regardless of that, and stay structurally identical
// to what Prisma.ProductGetPayload will produce once generated.
interface ProductSummaryRowShape {
  id: string;
  slug: string;
  name: string;
  shortDesc: string;
  price: unknown;
  discount: unknown;
  currency: string;
  featuredFlags: string[];
  categories: { name: string; slug: string }[];
  images: { url: string; imageType: string }[];
  inventory: { currentStock: number } | null;
  variants: { id: string; currentStock: number }[];
}

interface ProductDetailRowShape {
  id: string;
  slug: string;
  name: string;
  shortDesc: string;
  fullDesc: string;
  brand: string;
  price: unknown;
  discount: unknown;
  currency: string;
  weight: number | null;
  dimensions: string | null;
  warranty: string | null;
  tags: string[];
  featuredFlags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  variantType: string | null;
  categories: { name: string; slug: string }[];
  images: { url: string; altText: string | null; width: number | null; height: number | null; format: string | null; sortOrder: number }[];
  specs: { label: string; value: string }[];
  variants: {
    id: string;
    sku: string;
    value: string;
    currentStock: number;
    status: string;
    image: { url: string; altText: string | null } | null;
  }[];
  inventory: { currentStock: number } | null;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export function toProductSummaryDTO(row: ProductSummaryRowShape) {
  const cover = row.images.find((i) => i.imageType === "COVER") ?? row.images[0];
  const baseStock = row.inventory?.currentStock ?? 0;
  const variantStock = row.variants.reduce((sum, v) => sum + v.currentStock, 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDesc: row.shortDesc,
    categories: row.categories,
    price: toNumber(row.price),
    discount: row.discount ? toNumber(row.discount) : null,
    currency: row.currency,
    coverImage: cover?.url ?? null,
    images: row.images.map((i) => i.url),
    featuredFlags: row.featuredFlags,
    inStock: baseStock > 0 || variantStock > 0,
    hasVariants: row.variants.length > 0,
  };
}

export function toProductDetailDTO(row: ProductDetailRowShape) {
  const baseStock = row.inventory?.currentStock ?? 0;
  const variantStockTotal = row.variants.reduce((sum, v) => sum + v.currentStock, 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDesc: row.shortDesc,
    fullDesc: row.fullDesc,
    categories: row.categories,
    brand: row.brand,
    price: toNumber(row.price),
    discount: row.discount ? toNumber(row.discount) : null,
    currency: row.currency,
    weight: row.weight,
    dimensions: row.dimensions,
    warranty: row.warranty,
    tags: row.tags,
    featuredFlags: row.featuredFlags,
    images: row.images.map((img) => ({
      url: img.url,
      altText: img.altText,
      width: img.width,
      height: img.height,
      format: img.format,
      sortOrder: img.sortOrder,
    })),
    specs: row.specs,
    // `variantType` tells the storefront what "value" means for this
    // product ("Colour", "Size", a custom admin-defined label, etc.) —
    // null when the product has no variants.
    variantType: row.variantType,
    variants: row.variants
      .filter((v) => v.status !== "ARCHIVED") // sold-out variants stay visible; archived ones don't
      .map((v) => ({
        sku: v.sku,
        value: v.value,
        inStock: v.currentStock > 0,
        image: v.image?.url ?? null,
      })),
    inStock: baseStock > 0 || variantStockTotal > 0,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
  };
}
