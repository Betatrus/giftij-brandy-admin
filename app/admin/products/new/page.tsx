import { auth } from "@/auth";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { ProductForm } from "@/components/admin/products/product-form";

export default async function NewProductPage() {
  const session = await auth();
  const categories = await listCategoriesFlat();

  return (
    <div>
      <h1 className="font-display text-2xl text-ink mb-1">New Product</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Save the product to unlock image uploads and variants.
      </p>
      <ProductForm role={session!.user.role} categories={categories} />
    </div>
  );
}
