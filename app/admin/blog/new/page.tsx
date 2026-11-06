import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BlogEditor } from "@/components/admin/blog/blog-editor";

export default async function NewBlogPostPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"].includes(session.user.role)) redirect("/admin/dashboard");
  const categories = await prisma.blogCategory.findMany({ where: { isActive: true }, orderBy: [{sortOrder:"asc"},{name:"asc"}], select: {id:true,name:true} });
  return <div><Breadcrumbs items={[{label:"Home",href:"/admin/dashboard"},{label:"Blog Management",href:"/admin/blog"},{label:"New article"}]} /><h1 className="mb-5 font-display text-2xl text-ink">Create article</h1><BlogEditor categories={categories} /></div>;
}
