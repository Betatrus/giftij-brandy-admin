import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPromotionBuilderData } from "@/lib/actions/promotions";
import { PromotionManager } from "@/components/admin/promotions/promotion-manager";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function OffersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"].includes(session.user.role)) redirect("/admin/dashboard");
  const data = await getPromotionBuilderData();
  return <div>
    <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Marketing", href: "/admin/offers" }, { label: "Offers & campaigns" }]} />
    <PromotionManager initialCampaigns={data.campaigns as any} products={data.products} />
  </div>;
}
