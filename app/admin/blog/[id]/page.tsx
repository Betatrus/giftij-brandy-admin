import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BlogEditor } from "@/components/admin/blog/blog-editor";

export default async function EditBlogPostPage({params}:{params:Promise<{id:string}>}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"].includes(session.user.role)) redirect("/admin/dashboard");
  const {id}=await params;
  const [post,categories]=await Promise.all([
    prisma.blogPost.findUnique({where:{id}}),
    prisma.blogCategory.findMany({where:{isActive:true},orderBy:[{sortOrder:"asc"},{name:"asc"}],select:{id:true,name:true}})
  ]);
  if(!post) notFound();
  return <div><Breadcrumbs items={[{label:"Home",href:"/admin/dashboard"},{label:"Blog Management",href:"/admin/blog"},{label:"Edit article"}]} /><h1 className="mb-5 font-display text-2xl text-ink">Edit article</h1><BlogEditor categories={categories} post={{...post,categoryId:post.categoryId,tags:post.tags}} /></div>;
}
