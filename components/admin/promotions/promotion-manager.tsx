"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, Eye, Copy, Megaphone, Package, CalendarClock, Gift, Truck, Percent } from "lucide-react";
import { savePromotionCampaign, updatePromotionCampaignStatus } from "@/lib/actions/promotions";

type Product = { id: string; name: string; slug: string; price: number; discount: number };
type OfferSet = {
  id?: string; name: string; description: string; productIds: string[]; benefits: string[];
  discountType: "PERCENTAGE" | "FIXED"; discountValue: number; giftDescription: string;
  closingMode: "DURATION" | "ORDER_LIMIT"; endsAt: string; orderLimit: number; isEnabled: boolean;
};
type Campaign = {
  id: string; name: string; slug: string; status: "DRAFT" | "SCHEDULED" | "LIVE" | "PAUSED" | "ENDED";
  announcementMode: "HTML" | "FLYER"; imageUrl: string | null; headline: string; caption: string | null;
  message: string | null; ctaLabel: string; popupEnabled: boolean; bannerEnabled: boolean; popupSeconds: number;
  startsAt: Date | null; endsAt: Date | null; offerSets: Array<any>;
};
const emptySet = (): OfferSet => ({ name: "New offer set", description: "", productIds: [], benefits: ["DISCOUNT"], discountType: "PERCENTAGE", discountValue: 10, giftDescription: "", closingMode: "DURATION", endsAt: "", orderLimit: 30, isEnabled: true });
const dateInput = (date: Date | null) => date ? new Date(date).toISOString().slice(0,16) : "";

export function PromotionManager({ initialCampaigns, products }: { initialCampaigns: Campaign[]; products: Product[] }) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<"DRAFT"|"SCHEDULED"|"LIVE"|"PAUSED">("DRAFT");
  const [announcementMode, setAnnouncementMode] = useState<"HTML"|"FLYER">("HTML");
  const [imageUrl, setImageUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("Explore offers");
  const [popupEnabled, setPopupEnabled] = useState(true);
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [popupSeconds, setPopupSeconds] = useState(6);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [sets, setSets] = useState<OfferSet[]>([emptySet()]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();

  const activeProducts = useMemo(() => products, [products]);
  const reset = () => {
    setSelectedId(null); setName(""); setSlug(""); setStatus("DRAFT"); setAnnouncementMode("HTML");
    setImageUrl(""); setHeadline(""); setCaption(""); setMessage(""); setCtaLabel("Explore offers");
    setPopupEnabled(true); setBannerEnabled(false); setPopupSeconds(6); setStartsAt(""); setEndsAt("");
    setSets([emptySet()]); setError(""); setSuccess("");
  };
  const edit = (campaign: Campaign) => {
    setSelectedId(campaign.id); setName(campaign.name); setSlug(campaign.slug); setStatus(campaign.status === "ENDED" ? "DRAFT" : campaign.status);
    setAnnouncementMode(campaign.announcementMode); setImageUrl(campaign.imageUrl ?? ""); setHeadline(campaign.headline);
    setCaption(campaign.caption ?? ""); setMessage(campaign.message ?? ""); setCtaLabel(campaign.ctaLabel);
    setPopupEnabled(campaign.popupEnabled); setBannerEnabled(campaign.bannerEnabled); setPopupSeconds(campaign.popupSeconds);
    setStartsAt(dateInput(campaign.startsAt)); setEndsAt(dateInput(campaign.endsAt));
    setSets(campaign.offerSets.map((s) => ({ id:s.id, name:s.name, description:s.description ?? "", productIds:s.productIds,
      benefits:s.benefits, discountType:s.discountType ?? "PERCENTAGE", discountValue:Number(s.discountValue ?? 10),
      giftDescription:s.giftDescription ?? "", closingMode:s.closingMode, endsAt:dateInput(s.endsAt),
      orderLimit:s.orderLimit ?? 30, isEnabled:s.isEnabled })));
    setError(""); setSuccess("");
  };
  const patchSet = (index:number, patch:Partial<OfferSet>) => setSets(current => current.map((set,i)=>i===index?{...set,...patch}:set));
  const toggleValue = (values:string[], value:string) => values.includes(value)?values.filter(v=>v!==value):[...values,value];
  const submit = () => {
    setError(""); setSuccess("");
    startTransition(async () => {
      try {
        const result = await savePromotionCampaign({ id:selectedId ?? undefined, name, slug, status, announcementMode,
          imageUrl, headline, caption, message, ctaLabel, popupEnabled, bannerEnabled, popupSeconds, startsAt, endsAt, offerSets:sets });
        setSuccess("Campaign saved. Changes are now available to the storefront.");
        router.refresh();
        setSelectedId(result.id);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save this campaign."); }
    });
  };
  const changeStatus = (id:string, next:"DRAFT"|"SCHEDULED"|"LIVE"|"PAUSED"|"ENDED") => {
    startTransition(async()=>{try{await updatePromotionCampaignStatus(id,next);setCampaigns(items=>items.map(c=>c.id===id?{...c,status:next}:c));router.refresh();}catch(e){setError(e instanceof Error?e.message:"Could not update campaign.");}});
  };
  const campaignUrl = slug ? `https://www.giftijbrandy.com/offers/${slug}` : "";

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-2xl text-ink">Offers & campaigns</h1><p className="mt-1 text-sm text-ink/50">Create one campaign announcement and organise different product offers underneath it.</p></div>
      <button onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white"><Plus size={16}/> Create campaign</button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(250px,0.75fr)_minmax(0,2fr)]">
      <section className="rounded-2xl bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium text-ink">Your campaigns</h2><span className="rounded-full bg-cream px-2 py-1 text-xs text-ink/60">{campaigns.length}</span></div>
        <div className="space-y-2">
          {campaigns.map(c=><div key={c.id} className={`rounded-xl border p-3 ${selectedId===c.id?"border-gold bg-cream/60":"border-cream"}`}>
            <button onClick={()=>edit(c)} className="w-full text-left"><p className="font-medium text-sm text-ink">{c.name}</p><p className="mt-1 text-xs text-ink/45">/offers/{c.slug} · {c.offerSets.length} offer sets</p><span className="mt-2 inline-block rounded-full bg-cream px-2 py-1 text-[11px] text-ink/60">{c.status}</span></button>
            <div className="mt-3 flex flex-wrap gap-2">
              {c.status!=="LIVE" && <button onClick={()=>changeStatus(c.id,"LIVE")} className="text-xs font-medium text-green-700">Publish</button>}
              {c.status==="LIVE" && <button onClick={()=>changeStatus(c.id,"PAUSED")} className="text-xs font-medium text-amber-700">Pause</button>}
              <button onClick={()=>edit(c)} className="text-xs text-gold">Edit campaign</button>
            </div>
          </div>)}
          {campaigns.length===0 && <p className="rounded-xl bg-cream/60 p-4 text-sm text-ink/50">No campaigns yet. Create your first promotion.</p>}
        </div>
      </section>

      <div className="space-y-5">
        <section className="rounded-2xl bg-white p-5 shadow-soft md:p-6">
          <div className="mb-4 flex items-center gap-2"><Megaphone size={18} className="text-gold"/><h2 className="font-semibold text-ink">1. Campaign announcement</h2></div>
          <p className="mb-4 text-xs text-ink/50">This is the single creative customers see in your popup or announcement banner. Its button takes them to the campaign shopping page.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-ink/70">Campaign name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. The November Edit" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70">Campaign URL slug<div className="mt-1 flex items-center rounded-xl border border-cream px-3"><span className="text-xs text-ink/40">/offers/</span><input value={slug} onChange={e=>setSlug(e.target.value)} placeholder="november-edit" className="min-w-0 flex-1 py-2.5 text-sm outline-none"/></div></label>
            <label className="text-xs font-medium text-ink/70">Announcement design<select value={announcementMode} onChange={e=>setAnnouncementMode(e.target.value as any)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"><option value="HTML">Designed HTML announcement</option><option value="FLYER">Uploaded flyer</option></select></label>
            <label className="text-xs font-medium text-ink/70">Headline<input value={headline} onChange={e=>setHeadline(e.target.value)} placeholder="A little extra for you" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70 sm:col-span-2">Announcement image URL (optional for HTML)<input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="Paste an uploaded image URL" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70">Caption<input value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Discounts, free delivery and gifts" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70">Button text<input value={ctaLabel} onChange={e=>setCtaLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70 sm:col-span-2">Supporting message<textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3} placeholder="Tell customers what makes this campaign special." className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-sm text-ink/70">
            <label className="flex items-center gap-2"><input type="checkbox" checked={popupEnabled} onChange={e=>setPopupEnabled(e.target.checked)}/> Show as popup</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={bannerEnabled} onChange={e=>setBannerEnabled(e.target.checked)}/> Show announcement banner</label>
            <label className="flex items-center gap-2">Popup duration <input type="number" min={2} max={20} value={popupSeconds} onChange={e=>setPopupSeconds(Number(e.target.value))} className="w-16 rounded-lg border border-cream px-2 py-1"/> seconds</label>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-soft md:p-6">
          <div className="mb-4 flex items-center gap-2"><CalendarClock size={18} className="text-gold"/><h2 className="font-semibold text-ink">2. Campaign schedule</h2></div>
          <p className="mb-4 text-xs text-ink/50">Set when the campaign can be shown. Each offer set can also have its own closing rule.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-medium text-ink/70">Campaign status<select value={status} onChange={e=>setStatus(e.target.value as any)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"><option value="DRAFT">Draft</option><option value="SCHEDULED">Scheduled</option><option value="LIVE">Live</option><option value="PAUSED">Paused</option></select></label>
            <label className="text-xs font-medium text-ink/70">Starts at<input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
            <label className="text-xs font-medium text-ink/70">Campaign ends at (optional)<input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5 text-sm"/></label>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-soft md:p-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Package size={18} className="text-gold"/><h2 className="font-semibold text-ink">3. Offer sets</h2></div><button onClick={()=>setSets(s=>[...s,emptySet()])} className="inline-flex items-center gap-1 rounded-lg border border-cream px-3 py-2 text-xs font-medium text-ink"><Plus size={14}/> Add offer set</button></div>
          <p className="mb-5 text-xs text-ink/50">Each offer set targets its own products and can have different benefits and a different closing rule.</p>
          <div className="space-y-4">
            {sets.map((set,index)=><div key={index} className="rounded-2xl border border-cream p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><p className="font-semibold text-sm text-ink">Offer set {String(index+1).padStart(2,"0")}</p><button onClick={()=>setSets(s=>s.filter((_,i)=>i!==index))} disabled={sets.length===1} aria-label="Remove offer set" className="rounded-lg p-2 text-ink/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={16}/></button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-ink/70">Offer set name<input value={set.name} onChange={e=>patchSet(index,{name:e.target.value})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/></label>
                <label className="text-xs font-medium text-ink/70">Short description<input value={set.description} onChange={e=>patchSet(index,{description:e.target.value})} placeholder="What customers get" className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/></label>
              </div>
              <div className="mt-4"><p className="mb-2 text-xs font-semibold text-ink/70">Choose the benefits for this product group</p><div className="flex flex-wrap gap-3">
                {[["DISCOUNT","Discount",Percent],["FREE_DELIVERY","Free delivery",Truck],["FREE_GIFT","Free gift",Gift]].map(([value,label,Icon]:any)=><label key={value} className="flex items-center gap-2 rounded-lg border border-cream px-3 py-2 text-xs"><input type="checkbox" checked={set.benefits.includes(value)} onChange={()=>patchSet(index,{benefits:toggleValue(set.benefits,value)})}/><Icon size={14}/>{label}</label>)}
              </div></div>
              {set.benefits.includes("DISCOUNT") && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-ink/70">Discount type<select value={set.discountType} onChange={e=>patchSet(index,{discountType:e.target.value as any})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"><option value="PERCENTAGE">Percentage off</option><option value="FIXED">Fixed amount off (₦)</option></select></label><label className="text-xs font-medium text-ink/70">Discount value<input type="number" min="0.01" step="0.01" value={set.discountValue} onChange={e=>patchSet(index,{discountValue:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/></label></div>}
              {set.benefits.includes("FREE_GIFT") && <label className="mt-3 block text-xs font-medium text-ink/70">Gift customers receive<input value={set.giftDescription} onChange={e=>patchSet(index,{giftDescription:e.target.value})} placeholder="e.g. Complimentary travel pouch" className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/></label>}
              <div className="mt-4"><p className="mb-2 text-xs font-semibold text-ink/70">Products included</p><div className="max-h-48 overflow-y-auto rounded-xl border border-cream p-2 sm:grid sm:grid-cols-2">{activeProducts.map(product=><label key={product.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-ink/75 hover:bg-cream/60"><input type="checkbox" checked={set.productIds.includes(product.id)} onChange={()=>patchSet(index,{productIds:toggleValue(set.productIds,product.id)})}/><span className="min-w-0 flex-1 truncate">{product.name}</span><span className="text-ink/40">₦{product.price.toLocaleString("en-NG")}</span></label>)}</div><p className="mt-1 text-[11px] text-ink/40">{set.productIds.length} product(s) selected</p></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-ink/70">How should this offer close?<select value={set.closingMode} onChange={e=>patchSet(index,{closingMode:e.target.value as any})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"><option value="DURATION">At a set date and time</option><option value="ORDER_LIMIT">After a number of paid orders</option></select></label>{set.closingMode==="DURATION"?<label className="text-xs font-medium text-ink/70">Offer ends at<input type="datetime-local" value={set.endsAt} onChange={e=>patchSet(index,{endsAt:e.target.value})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/></label>:<label className="text-xs font-medium text-ink/70">Maximum qualifying paid orders<input type="number" min="1" value={set.orderLimit} onChange={e=>patchSet(index,{orderLimit:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-cream px-3 py-2 text-sm"/><span className="mt-1 block text-[11px] text-ink/40">One shared limit across all products in this offer set.</span></label>}</div>
              <label className="mt-3 flex items-center gap-2 text-xs text-ink/60"><input type="checkbox" checked={set.isEnabled} onChange={e=>patchSet(index,{isEnabled:e.target.checked})}/> Include this offer set in the campaign</label>
            </div>)}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-soft md:p-6">
          <div className="mb-3 flex items-center gap-2"><Eye size={18} className="text-gold"/><h2 className="font-semibold text-ink">4. Review and publish</h2></div>
          <p className="text-sm text-ink">{name || "Your campaign"} · {sets.length} offer set(s)</p>
          <p className="mt-1 break-all text-xs text-ink/45">{campaignUrl || "Your campaign URL will appear here."}</p>
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={pending} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Save size={16}/>{pending?"Saving…":"Save campaign"}</button>{campaignUrl && <button onClick={()=>navigator.clipboard.writeText(campaignUrl)} className="inline-flex items-center gap-2 rounded-xl border border-cream px-4 py-3 text-sm text-ink"><Copy size={15}/> Copy campaign URL</button>}</div>
          <p className="mt-3 text-[11px] text-ink/40">Saving updates the campaign configuration. Public discount, delivery and gift eligibility must be checked by the checkout backend before this campaign is enabled for live sales.</p>
        </section>
      </div>
    </div>
  </div>;
}
