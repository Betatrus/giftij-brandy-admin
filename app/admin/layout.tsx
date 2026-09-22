import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminInactivityGuard } from "@/components/admin/admin-inactivity-guard";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <>
      <AdminInactivityGuard />

      <AdminShell
        role={session.user.role}
        userName={session.user.name}
      >
        {children}
      </AdminShell>
    </>
  );
}