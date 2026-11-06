import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { CategoryTable } from "@/components/admin/categories/category-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function CategoriesPage() {
  const session = await auth();

  // Taxonomy changes are a Super Admin decision — same page-level +
  // middleware belt-and-suspenders pattern used by /admin/staff.
  if (session?.user?.role !== "SUPER_ADMIN" && session?.user?.role !== "TECHNICAL_SUPPORT") {
    redirect("/admin/dashboard?denied=1");
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Categories" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Categories</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Manage the product categories used across Products, Inventory, and Orders.
      </p>
      <CategoryTable />
    </div>
  );
}
