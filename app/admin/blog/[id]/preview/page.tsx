import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export default async function BlogPreviewPage({params}:{params:Promise<{id:string}>}) {
  const session=await auth();
  if(!session?.user)redirect("/login");
  if(session.user.role!=="SUPER_ADMIN")redirect("/admin/dashboard");
  const {id}=await params;
  const post=await prisma.blogPost.findUnique({where:{id},include:{category:{select:{name:true}}}});
  if(!post)notFound();
  return <div className="mx-auto max-w-4xl">
    <Breadcrumbs items={[{label:"Home",href:"/admin/dashboard"},{label:"Blog Management",href:"/admin/blog"},{label:"Preview"}]} />
    <div className="mb-6 flex items-center justify-between gap-3"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">Private preview · not public</span><Link href={`/admin/blog/${post.id}`} className="text-sm text-gold hover:underline">Back to editor</Link></div>
    <article className="rounded-2xl bg-white p-6 shadow-soft md:p-10">
      <p className="mb-3 text-xs uppercase tracking-wider text-gold">{post.category?.name??"Giftij Journal"} · {post.type.replaceAll("_"," ")}</p>
      <h1 className="mb-4 font-display text-3xl text-ink md:text-5xl">{post.title}</h1>
      <p className="mb-8 text-lg leading-8 text-ink/60">{post.excerpt}</p>
      {post.coverImageUrl&&<img src={post.coverImageUrl} alt={post.coverImageAlt??post.title} className="mb-8 max-h-[480px] w-full rounded-xl object-cover" />}
      <div className="whitespace-pre-wrap text-base leading-8 text-ink/80">{post.contentMarkdown}</div>
    </article>
  </div>;
}
