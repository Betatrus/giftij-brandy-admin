import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { StaffTable } from "@/components/admin/staff/staff-table";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function StaffPage() {
  const session = await auth();

  // Belt-and-suspenders: middleware already blocks Support Admin from
  // this route, but the page checks too rather than relying on a single
  // layer — same pattern as financial-field stripping elsewhere.
  if (session?.user?.role !== "SUPER_ADMIN" && session?.user?.role !== "TECHNICAL_SUPPORT") {
    redirect("/admin/dashboard?denied=1");
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Staff" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Staff</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Manage admin accounts, roles, and access.
      </p>
      <StaffTable currentUserId={session.user.id} canAssignElevatedRoles={session.user.role === "SUPER_ADMIN"} />
    </div>
  );
}
