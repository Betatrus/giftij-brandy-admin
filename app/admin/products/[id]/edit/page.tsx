import { auth } from "@/auth";
import { getProduct } from "@/lib/actions/products";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { serializeProduct } from "@/lib/utils/serialize";
import { ProductForm } from "@/components/admin/products/product-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BackLink } from "@/components/ui/back-link";
import type { ProductInput } from "@/lib/validators/product";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const [raw, categories] = await Promise.all([getProduct(id), listCategoriesFlat()]);
  const product = serializeProduct(raw as unknown as Record<string, unknown>) as unknown as {
    name: string;
    slug: string;
    shortDesc: string;
    fullDesc: string;
    categories: { id: string; name: string; slug: string }[];
    brand: string;
    sku: string;
    barcode: string | null;
    price: number;
    costPrice?: number;
    discount: number | null;
    currency: string;
    weight: number | null;
    dimensions: string | null;
    warranty: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    status: "DRAFT" | "ACTIVE" | "ARCHIVED";
    tags: string[];
    featuredFlags: string[];
    variantType: string | null;
    specs: { id: string; label: string; value: string }[];
    variants: { id: string; value: string; sku: string; currentStock: number; status: string }[];
    images: { id: string; url: string; sortOrder: number }[];
  };

  const defaultValues: Partial<ProductInput> = {
    name: product.name,
    slug: product.slug,
    shortDesc: product.shortDesc,
    fullDesc: product.fullDesc,
    categoryIds: product.categories.map((c) => c.id),
    brand: product.brand,
    sku: product.sku,
    barcode: product.barcode,
    price: product.price,
    costPrice: product.costPrice ?? 0,
    discount: product.discount,
    currency: product.currency,
    weight: product.weight,
    dimensions: product.dimensions,
    warranty: product.warranty,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    status: product.status,
    tags: product.tags,
    featuredFlags: product.featuredFlags as ProductInput["featuredFlags"],
    specs: product.specs,
    hasVariants: product.variants.length > 0,
    variantType: product.variantType,
    variants: product.variants.map((v) => ({
      id: v.id,
      value: v.value,
      sku: v.sku,
      stock: v.currentStock,
      status: v.status as "DRAFT" | "ACTIVE" | "ARCHIVED",
    })),
  };

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/admin/dashboard" },
          { label: "Products", href: "/admin/products" },
          { label: product.name },
        ]}
      />
      <BackLink href="/admin/products" label="Back to Products" />
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl text-ink">Edit Product</h1>
        <a href={`/admin/inventory#product-${id}`} className="font-body text-xs text-gold underline">
          View in Inventory →
        </a>
      </div>
      <p className="font-body text-sm text-ink/50 mb-6">{product.name}</p>
      <ProductForm
        role={session!.user.role}
        productId={id}
        defaultValues={defaultValues}
        existingImages={product.images}
        categories={categories}
      />
    </div>
  );
}
