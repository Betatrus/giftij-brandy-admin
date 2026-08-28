import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BestSellerPicker } from "@/components/admin/best-sellers/best-seller-picker";

export default function BestSellersPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Best Sellers" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Best Sellers</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Exactly 4 slots — 2 Bags, 1 Shoe, 1 Slipper.
      </p>
      <BestSellerPicker />
    </div>
  );
}
