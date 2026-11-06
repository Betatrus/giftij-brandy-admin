"use client";
import { useState, useTransition } from "react";
import { updateBlogVisibility } from "@/lib/actions/blog";

export function BlogVisibilityForm({navigationVisible,indexingEnabled}:{navigationVisible:boolean;indexingEnabled:boolean}) {
  const [navigation,setNavigation]=useState(navigationVisible);
  const [indexing,setIndexing]=useState(indexingEnabled);
  const [pending,startTransition]=useTransition();
  const [message,setMessage]=useState("");
  function save(){setMessage("");startTransition(async()=>{try{await updateBlogVisibility({navigationVisible:navigation,indexingEnabled:indexing});setMessage("Blog settings saved.");}catch(e){setMessage(e instanceof Error?e.message:"Could not save settings.");}});}
  return <div className="space-y-4">
    <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={navigation} onChange={e=>setNavigation(e.target.checked)} /><span><strong>Show Blog in storefront navigation</strong><span className="mt-1 block text-xs text-ink/50">Keep this off until the blog has enough useful published content.</span></span></label>
    <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={indexing} onChange={e=>setIndexing(e.target.checked)} /><span><strong>Enable blog search indexing</strong><span className="mt-1 block text-xs text-ink/50">This is a global switch. Each article must also be marked indexable before it can enter the sitemap.</span></span></label>
    <button type="button" disabled={pending} onClick={save} className="rounded-xl bg-gold px-4 py-2 text-sm text-white disabled:opacity-50">{pending?"Saving...":"Save blog settings"}</button>
    {message&&<p role="status" className="text-xs text-ink/60">{message}</p>}
  </div>;
}
