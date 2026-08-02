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
  category: { select: { name: true, slug: true } },
  images: {
    select: { url: true, imageType: true },
    orderBy: { sortOrder: "asc" as const },
  },
  inventory: { select: { currentStock: true } },
  variants: { select: { id: true, stock: true } },
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
  category: { select: { name: true, slug: true } },
  images: {
    select: { url: true, altText: true, width: true, height: true, format: true, sortOrder: true },
    orderBy: { sortOrder: "asc" as const },
  },
  specs: { select: { label: true, value: true } },
  variants: {
    select: {
      sku: true,
      color: true,
      size: true,
      material: true,
      pattern: true,
      price: true,
      stock: true,
      images: { select: { url: true } },
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
  category: { name: string; slug: string };
  images: { url: string; imageType: string }[];
  inventory: { currentStock: number } | null;
  variants: { id: string; stock: number }[];
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
  category: { name: string; slug: string };
  images: { url: string; altText: string | null; width: number | null; height: number | null; format: string | null; sortOrder: number }[];
  specs: { label: string; value: string }[];
  variants: {
    sku: string;
    color: string | null;
    size: string | null;
    material: string | null;
    pattern: string | null;
    price: unknown;
    stock: number;
    images: { url: string }[];
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
  const variantStock = row.variants.reduce((sum, v) => sum + v.stock, 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDesc: row.shortDesc,
    category: row.category,
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
  const variantStockTotal = row.variants.reduce((sum, v) => sum + v.stock, 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDesc: row.shortDesc,
    fullDesc: row.fullDesc,
    category: row.category,
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
    variants: row.variants.map((v) => ({
      sku: v.sku,
      color: v.color,
      size: v.size,
      material: v.material,
      pattern: v.pattern,
      price: v.price ? toNumber(v.price) : null,
      inStock: v.stock > 0,
      images: v.images.map((i) => i.url),
    })),
    inStock: baseStock > 0 || variantStockTotal > 0,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
  };
}
