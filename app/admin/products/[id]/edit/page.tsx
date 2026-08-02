import { auth } from "@/auth";
import { getProduct } from "@/lib/actions/products";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { serializeProduct } from "@/lib/utils/serialize";
import { ProductForm } from "@/components/admin/products/product-form";
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
    categoryId: string;
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
    specs: { id: string; label: string; value: string }[];
    variants: { id: string; color: string | null; size: string | null; material: string | null; pattern: string | null; sku: string; price: number | null; stock: number; status: string }[];
    images: { id: string; url: string; sortOrder: number }[];
  };

  const defaultValues: Partial<ProductInput> = {
    name: product.name,
    slug: product.slug,
    shortDesc: product.shortDesc,
    fullDesc: product.fullDesc,
    categoryId: product.categoryId,
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
    variants: product.variants.map((v) => ({ ...v, status: v.status as "DRAFT" | "ACTIVE" | "ARCHIVED" })),
  };

  return (
    <div>
      <h1 className="font-display text-2xl text-ink mb-1">Edit Product</h1>
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
