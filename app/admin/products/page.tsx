import { auth } from "@/auth";
import { listCategoriesFlat } from "@/lib/actions/categories";
import { ProductTable } from "@/components/admin/products/product-table";

export default async function ProductsPage() {
  const session = await auth();
  const categories = await listCategoriesFlat();

  return (
    <div>
      <h1 className="font-display text-2xl text-ink mb-1">Products</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Manage your catalog, variants, and homepage placement.
      </p>
      <ProductTable role={session!.user.role} categories={categories} />
    </div>
  );
}
