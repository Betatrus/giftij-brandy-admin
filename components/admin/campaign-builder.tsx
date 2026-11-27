"use client";

import { useMemo, useState, useTransition } from "react";
import { createOfferCampaign, updateOfferCampaignStatus } from "@/lib/actions/offer-campaigns";
import { CampaignCreativeUploader } from "@/components/admin/campaign-creative-uploader";

type Product = { id: string; name: string; price: unknown; currency: string };

const money=(v:unknown)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(v??0));

export function CampaignBuilder({products}:{products:Product[]}) {
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState<string[]>([]);
  const [created,setCreated]=useState<{id:string;title:string}|null>(null);
  const [error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const matches=useMemo(()=>products.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())),[products,search]);
  const selectedProducts=useMemo(()=>products.filter(p=>selected.includes(p.id)),[products,selected]);
  function submit(form:HTMLFormElement){
    setError("");
    const data=new FormData(form);
    selected.forEach(id=>data.append("productIds",id));
    startTransition(async()=>{
      try{const result=await createOfferCampaign(data);setCreated(result);}
      catch(e){setError(e instanceof Error?e.message:"Could not create the campaign. Please try again.");}
    });
  }
  function setStatus(status:"PUBLISHED"|"DRAFT"){
    if(!created)return;
    const data=new FormData();data.set("campaignId",created.id);data.set("status",status);
    startTransition(async()=>{
      try{await updateOfferCampaignStatus(data);setOpen(false);setCreated(null);setSelected([]);window.location.reload();}
      catch(e){setError(e instanceof Error?e.message:"Could not update campaign status.");}
    });
  }
  return <>
    <button type="button" onClick={()=>{setOpen(true);setCreated(null);setError("");}} className="rounded-xl bg-gold px-4 py-2.5 text-sm font-medium text-white">+ Create Campaign</button>
    {open&&<div role="dialog" aria-modal="true" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl md:p-7">
        {!created?<>
          <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-ink/45">Campaign builder</p><h2 className="mt-1 font-display text-2xl text-ink">Create a campaign</h2><p className="mt-1 text-sm text-ink/55">Set up the campaign and its first Offer Set together.</p></div><button type="button" onClick={()=>setOpen(false)} aria-label="Close" className="rounded-full border border-cream px-3 py-1.5">✕</button></div>
          <form onSubmit={e=>{e.preventDefault();submit(e.currentTarget);}} className="space-y-5">
            <section className="grid gap-3 md:grid-cols-2"><h3 className="md:col-span-2 text-sm font-semibold text-ink">Campaign details</h3>
              <label className="text-sm text-ink/70">Campaign title<input name="title" required maxLength={120} placeholder="e.g. Festive Gift Offers" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="text-sm text-ink/70">URL slug<input name="slug" maxLength={90} placeholder="festive-gift-offers" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="md:col-span-2 text-sm text-ink/70">Description<textarea name="description" rows={2} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <CampaignCreativeUploader />
              <label className="text-sm text-ink/70">CTA text<input name="ctaText" defaultValue="Shop the offer" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="text-sm text-ink/70">Starts at<input name="startsAt" type="datetime-local" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="text-sm text-ink/70">Ends at<input name="endsAt" type="datetime-local" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="text-sm text-ink/70">Campaign order cap<input name="maxQualifyingOrders" type="number" min="1" step="1" placeholder="Optional" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
            </section>
            <section className="space-y-3 rounded-xl border border-cream p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-ink">Offer Set</h3><p className="text-xs text-ink/50">The first offer set is part of this campaign.</p></div><span className="rounded-full bg-cream px-3 py-1 text-xs">01</span></div>
              <label className="block text-sm text-ink/70">Offer Set name<input name="offerSetTitle" required maxLength={100} placeholder="e.g. First 30 Orders" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <label className="block text-sm text-ink/70">Search products<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type a product name to search..." className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">{matches.map(p=><label key={p.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${selected.includes(p.id)?"border-gold bg-cream/50":"border-cream"}`}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/><span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{p.name}</span><span className="text-xs text-ink/50">{money(p.price)}</span></span></label>)}</div>
              <div className="flex flex-wrap gap-2">{selectedProducts.map(p=><span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-cream px-3 py-1.5 text-xs text-ink">{p.name}<button type="button" aria-label={`Remove ${p.name}`} onClick={()=>setSelected(old=>old.filter(id=>id!==p.id))}>×</button></span>)}</div><p className="text-xs text-ink/50">{selected.length} product{selected.length===1?"":"s"} selected</p>
              <label className="block text-sm text-ink/70">Offer Set description<textarea name="offerDescription" rows={2} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
              <div className="grid gap-3 md:grid-cols-2"><label className="text-sm text-ink/70">Discount percentage<input name="discountPercent" type="number" min="0.01" max="99.99" step="0.01" placeholder="Optional" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label><label className="text-sm text-ink/70">Fixed discount (₦)<input name="discountAmount" type="number" min="0.01" step="0.01" placeholder="Optional" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label></div>
              <label className="block text-sm text-ink/70">Maximum qualifying orders for this Offer Set<input name="offerSetMaxQualifyingOrders" type="number" min="1" step="1" placeholder="Optional" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input name="freeDelivery" type="checkbox"/> Free delivery</label><label className="flex items-center gap-2 text-sm">Gift<input name="giftDescription" placeholder="Gift description" className="rounded-lg border border-cream px-2 py-1.5"/></label></div>
            </section>
            <label className="block text-sm text-ink/70">Announcement HTML (optional)<textarea name="announcementHtml" rows={3} maxLength={20000} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 font-mono text-xs"/></label>
            {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="rounded-xl border border-cream px-4 py-2.5 text-sm">Cancel</button><button disabled={pending||!selected.length} className="rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending?"Creating...":"Create campaign"}</button></div>
          </form>
        </>:<div className="py-8 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-3xl text-green-700">✓</div><h2 className="font-display text-2xl text-ink">Campaign created</h2><p className="mt-2 text-sm text-ink/60">{created.title} and its first Offer Set have been saved successfully.</p><p className="mt-6 text-sm font-medium text-ink">What would you like to do next?</p><div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" disabled={pending} onClick={()=>setStatus("PUBLISHED")} className="rounded-xl bg-gold px-5 py-3 text-sm font-medium text-white">Publish campaign</button><button type="button" disabled={pending} onClick={()=>setStatus("DRAFT")} className="rounded-xl border border-cream px-5 py-3 text-sm font-medium text-ink">Save as draft</button></div>{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}</div>}
      </div>
    </div>}
  </>;
}
