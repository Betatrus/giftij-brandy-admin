"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBlogPost, createBlogCategory, archiveBlogPost } from "@/lib/actions/blog";

type Category = { id: string; name: string };
type Post = {
  id: string; title: string; slug: string; excerpt: string; contentMarkdown: string;
  type: "GUIDE" | "CUSTOMER_STORY" | "FAQ" | "ANNOUNCEMENT"; categoryId: string | null;
  tags: string[]; coverImageUrl: string | null; coverImageAlt: string | null;
  seoTitle: string | null; seoDescription: string | null; canonicalUrl: string | null;
  isFeatured: boolean; isIndexable: boolean; status: string;
};
const inputClass = "w-full rounded-xl border border-cream px-3 py-2.5 text-sm font-body text-ink outline-none focus:border-gold";
const labelClass = "mb-1 block text-xs font-medium text-ink/70";

export function BlogEditor({ categories, post }: { categories: Category[]; post?: Post }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [categoryList, setCategoryList] = useState(categories);
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [content, setContent] = useState(post?.contentMarkdown ?? "");
  const [type, setType] = useState<Post["type"]>(post?.type ?? "GUIDE");
  const [categoryId, setCategoryId] = useState(post?.categoryId ?? "");
  const [tags, setTags] = useState(post?.tags.join(", ") ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl ?? "");
  const [coverImageAlt, setCoverImageAlt] = useState(post?.coverImageAlt ?? "");
  const [seoTitle, setSeoTitle] = useState(post?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(post?.seoDescription ?? "");
  const [canonicalUrl, setCanonicalUrl] = useState(post?.canonicalUrl ?? "");
  const [featured, setFeatured] = useState(post?.isFeatured ?? false);
  const [indexable, setIndexable] = useState(post?.isIndexable ?? false);

  function submit(intent: "DRAFT" | "PUBLISH") {
    setError("");
    startTransition(async () => {
      try {
        await saveBlogPost({
          id: post?.id, title, slug, excerpt, contentMarkdown: content, type,
          categoryId, tags, coverImageUrl, coverImageAlt, seoTitle, seoDescription,
          canonicalUrl, isFeatured: featured, isIndexable: indexable, intent,
        });
        router.push("/admin/blog");
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save article."); }
    });
  }

  async function addCategory() {
    const name = window.prompt("New blog category name");
    if (!name?.trim()) return;
    startTransition(async () => {
      try {
        const created = await createBlogCategory({ name });
        setCategoryList((current) => [...current, created]);
        setCategoryId(created.id);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not create category."); }
    });
  }

  return <form onSubmit={(e) => e.preventDefault()} className="space-y-5 max-w-4xl">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section className="rounded-2xl bg-white p-5 md:p-6 shadow-soft space-y-4">
      <div><label className={labelClass}>Article title *</label><input className={inputClass} value={title} onChange={e=>{setTitle(e.target.value);if(!post)setSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""));}} maxLength={120} required /></div>
      <div><label className={labelClass}>URL slug *</label><input className={inputClass} value={slug} onChange={e=>setSlug(e.target.value)} maxLength={90} required /><p className="mt-1 text-xs text-ink/45">Public URL: /blog/{slug || "your-article-slug"}</p></div>
      <div><label className={labelClass}>Short summary *</label><textarea className={inputClass} rows={3} value={excerpt} onChange={e=>setExcerpt(e.target.value)} maxLength={320} required /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className={labelClass}>Article type</label><select className={inputClass} value={type} onChange={e=>setType(e.target.value as Post["type"])}><option value="GUIDE">Buying / care guide</option><option value="CUSTOMER_STORY">Customer story</option><option value="FAQ">FAQ / explainer</option><option value="ANNOUNCEMENT">Announcement</option></select></div>
        <div><label className={labelClass}>Category</label><div className="flex gap-2"><select className={inputClass} value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Uncategorised</option>{categoryList.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" onClick={addCategory} className="shrink-0 rounded-xl border border-cream px-3 text-sm">Add</button></div></div>
      </div>
      <div><label className={labelClass}>Tags (comma separated)</label><input className={inputClass} value={tags} onChange={e=>setTags(e.target.value)} placeholder="handbags, shopping tips, Nigeria" /></div>
    </section>
    <section className="rounded-2xl bg-white p-5 md:p-6 shadow-soft space-y-4">
      <div><label className={labelClass}>Article body (Markdown) *</label><textarea className={inputClass+" min-h-[420px] font-mono text-sm"} value={content} onChange={e=>setContent(e.target.value)} placeholder={"# Introduction\n\nWrite useful, original content here..."} required /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className={labelClass}>Cover image URL</label><input className={inputClass} type="url" value={coverImageUrl} onChange={e=>setCoverImageUrl(e.target.value)} placeholder="https://..." /></div>
        <div><label className={labelClass}>Cover image alt text</label><input className={inputClass} value={coverImageAlt} onChange={e=>setCoverImageAlt(e.target.value)} maxLength={180} /></div>
      </div>
      <p className="text-xs text-ink/45">Use an HTTPS image URL. Add descriptive alt text; avoid keyword stuffing.</p>
    </section>
    <section className="rounded-2xl bg-white p-5 md:p-6 shadow-soft space-y-4">
      <h2 className="font-medium text-sm">Search appearance</h2>
      <div><label className={labelClass}>SEO page title (recommended 50–60 characters)</label><input className={inputClass} value={seoTitle} onChange={e=>setSeoTitle(e.target.value)} maxLength={70} placeholder={title || "Primary search phrase | Giftij Brandy"} /><p className="mt-1 text-xs text-ink/45">{seoTitle.length}/70 characters</p></div>
      <div><label className={labelClass}>Meta description (recommended 140–160 characters)</label><textarea className={inputClass} rows={2} value={seoDescription} onChange={e=>setSeoDescription(e.target.value)} maxLength={170} /><p className="mt-1 text-xs text-ink/45">{seoDescription.length}/170 characters</p></div>
      <div><label className={labelClass}>Canonical URL (optional)</label><input className={inputClass} type="url" value={canonicalUrl} onChange={e=>setCanonicalUrl(e.target.value)} placeholder="Leave blank to use the article URL" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={featured} onChange={e=>setFeatured(e.target.checked)} /> Feature this article</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={indexable} onChange={e=>setIndexable(e.target.checked)} /> Allow search engines to index this article (global setting must also be enabled)</label>
    </section>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={pending} onClick={()=>submit("DRAFT")} className="rounded-xl border border-cream px-5 py-3 text-sm font-medium disabled:opacity-50">{pending?"Saving...":"Save draft"}</button>
      <button type="button" disabled={pending} onClick={()=>submit("PUBLISH")} className="rounded-xl bg-gold px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{pending?"Saving...":post?.status==="PUBLISHED"?"Save & update published article":"Publish article"}</button>
      {post && post.status!=="ARCHIVED" && <button type="button" disabled={pending} onClick={()=>startTransition(async()=>{try{await archiveBlogPost(post.id);router.push("/admin/blog");router.refresh();}catch(e){setError(e instanceof Error?e.message:"Could not archive article.");}})} className="ml-auto rounded-xl px-4 py-3 text-sm text-red-600">Archive</button>}
    </div>
  </form>;
}
