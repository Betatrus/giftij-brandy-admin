import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function BlogManagementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"].includes(session.user.role)) redirect("/admin/dashboard");
  const posts = await prisma.blogPost.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { category: { select: { name: true } } },
  });
  return <div>
    <Breadcrumbs items={[{label:"Home",href:"/admin/dashboard"},{label:"Blog Management"}]} />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl text-ink">Blog Management</h1><p className="mt-1 text-sm text-ink/50">Create useful articles, manage drafts and publish search-friendly content.</p></div>
      <Link href="/admin/blog/new" className="rounded-xl bg-gold px-4 py-2.5 text-sm font-medium text-white">New article</Link>
    </div>
    <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
      {posts.length ? <div className="divide-y divide-cream">{posts.map(post=><div key={post.id} className="flex flex-wrap items-center justify-between gap-3 p-4 md:px-5">
        <div className="min-w-0"><p className="font-medium text-sm text-ink">{post.title}</p><p className="mt-1 text-xs text-ink/45">/blog/{post.slug} · {post.category?.name ?? "Uncategorised"} · Updated {post.updatedAt.toLocaleDateString("en-NG")}</p></div>
        <div className="flex items-center gap-3"><span className={"rounded-full px-2.5 py-1 text-xs "+(post.status==="PUBLISHED"?"bg-green-50 text-green-700":post.status==="ARCHIVED"?"bg-cream text-ink/50":"bg-amber-50 text-amber-700")}>{post.status}</span><Link href={`/admin/blog/${post.id}`} className="text-sm text-gold hover:underline">Edit</Link></div>
      </div>)}</div> : <div className="p-10 text-center"><p className="font-medium text-ink">No articles yet</p><p className="mt-1 text-sm text-ink/50">Create your first original buying guide or product-care article.</p></div>}
    </div>
  </div>;
}
