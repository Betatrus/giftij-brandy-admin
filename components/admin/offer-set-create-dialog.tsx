"use client";

import { useMemo, useState, useTransition } from "react";
import { createOfferSet } from "@/lib/actions/offer-campaigns";

type Product = { id: string; name: string; price: unknown; currency: string };
const money=(v:unknown)=>new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(v??0));

export function OfferSetCreateDialog({campaignId,products}:{campaignId:string;products:Product[]}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(""),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState("");
  const [pending,startTransition]=useTransition();
  const matches=useMemo(()=>products.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())),[products,search]);
  const selectedProducts=useMemo(()=>products.filter(p=>selected.includes(p.id)),[products,selected]);
  function submit(form:HTMLFormElement){
    const data=new FormData(form);data.set("campaignId",campaignId);selected.forEach(id=>data.append("productIds",id));setError("");
    startTransition(async()=>{try{await createOfferSet(data);setOpen(false);setSelected([]);window.location.reload();}catch(e){setError(e instanceof Error?e.message:"Could not create Offer Set.");}});
  }
  return <>
    <button type="button" onClick={()=>{setOpen(true);setError("");}} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-cream bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-cream/50"><span className="text-lg leading-none">＋</span> Add Offer Set</button>
    {open&&<div role="dialog" aria-modal="true" className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl md:p-6">
        <div className="mb-4 flex items-start justify-between"><div><p className="text-xs uppercase tracking-wider text-ink/45">Campaign sub-form</p><h3 className="mt-1 font-display text-xl text-ink">Add an Offer Set</h3><p className="mt-1 text-xs text-ink/55">Choose products and the benefits for this set.</p></div><button type="button" onClick={()=>setOpen(false)} aria-label="Close" className="rounded-full border border-cream px-3 py-1.5">✕</button></div>
        <form onSubmit={e=>{e.preventDefault();submit(e.currentTarget);}} className="space-y-3">
          <label className="block text-sm text-ink/70">Offer Set name<input name="title" required maxLength={100} placeholder="e.g. First 30 Orders" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
          <label className="block text-sm text-ink/70">Search products<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by product name..." className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
          <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{matches.map(p=><label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-xs ${selected.includes(p.id)?"border-gold bg-cream/50":"border-cream"}`}><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/><span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{p.name}</span><span className="text-ink/50">{money(p.price)}</span></span></label>)}</div>
          <div className="flex flex-wrap gap-2">{selectedProducts.map(p=><span key={p.id} className="rounded-full bg-cream px-3 py-1.5 text-xs">{p.name}<button type="button" className="ml-2" onClick={()=>setSelected(old=>old.filter(id=>id!==p.id))}>×</button></span>)}</div>
          <p className="text-xs text-ink/50">{selected.length} product(s) selected</p>
          <label className="block text-sm text-ink/70">Description<textarea name="description" rows={2} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-ink/70">Discount percentage<input name="discountPercent" type="number" min="0.01" max="99.99" step="0.01" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label><label className="text-sm text-ink/70">Fixed discount (₦)<input name="discountAmount" type="number" min="0.01" step="0.01" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label></div>
          <label className="block text-sm text-ink/70">Maximum qualifying paid orders<input name="maxQualifyingOrders" type="number" min="1" step="1" placeholder="Optional" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5"/></label>
          <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input name="freeDelivery" type="checkbox"/> Free delivery</label><label className="flex items-center gap-2 text-sm">Gift<input name="giftDescription" placeholder="Gift description" className="rounded-lg border border-cream px-2 py-1.5"/></label></div>
          {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={()=>setOpen(false)} className="rounded-xl border border-cream px-4 py-2.5 text-sm">Cancel</button><button disabled={pending||!selected.length} className="rounded-xl bg-gold px-4 py-2.5 text-sm text-white disabled:opacity-50">{pending?"Saving...":"Create Offer Set"}</button></div>
        </form>
      </div>
    </div>}
  </>;
}
