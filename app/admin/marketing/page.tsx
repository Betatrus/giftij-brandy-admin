import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { activateOfferSet, createOfferCampaign, createOfferSet, updateOfferCampaignStatus } from "@/lib/actions/offer-campaigns";

const money = (value: unknown) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export default async function MarketingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canManageOffers = ["SUPER_ADMIN", "TECHNICAL_SUPPORT"].includes(session.user.role);
  const [campaigns, products, blogCount] = await Promise.all([
    canManageOffers ? prisma.offerCampaign.findMany({ orderBy: { updatedAt: "desc" }, include: { offerSets: { orderBy: { sortOrder: "asc" }, include: { products: { include: { product: { select: { id: true, name: true, price: true, slug: true } } } } } } }) : Promise.resolve([]),
    canManageOffers ? prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, price: true, currency: true } }) : Promise.resolve([]),
    prisma.blogPost.count(),
  ]);
  return <div>
    <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Marketing" }]} />
    <div className="mb-7"><h1 className="font-display text-2xl text-ink">Marketing</h1><p className="mt-1 text-sm text-ink/50">Manage editorial content and customer-facing promotions from one place.</p></div>
    <div className="grid gap-4 md:grid-cols-2 mb-8">
      <section className="rounded-2xl border border-cream bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-ink/45">Editorial</p><h2 className="mt-1 font-display text-xl text-ink">Blog Management</h2><p className="mt-2 text-sm text-ink/55">Create articles, manage drafts and publish useful content.</p></div><span className="rounded-full bg-cream px-3 py-1 text-xs text-ink/60">{blogCount} articles</span></div>
        <Link href="/admin/blog" className="mt-5 inline-flex rounded-xl border border-cream px-4 py-2.5 text-sm font-medium text-ink hover:bg-cream/60">Open Blog Management</Link>
      </section>
      <section className="rounded-2xl border border-cream bg-white p-5 shadow-soft">
        <p className="text-xs uppercase tracking-wide text-ink/45">Promotions</p><h2 className="mt-1 font-display text-xl text-ink">Offer Campaigns</h2><p className="mt-2 text-sm text-ink/55">Build shareable campaigns with multiple Offer Sets and product benefits.</p>
        <p className="mt-4 text-sm text-ink/70">{canManageOffers ? `${campaigns.length} campaigns` : "Campaign management is available to Super Admin and Technical Support."}</p>
      </section>
    </div>
    {canManageOffers ? <>
      <section className="mb-8 rounded-2xl border border-cream bg-white p-5 shadow-soft">
        <h2 className="font-display text-lg text-ink">Create an Offer Campaign</h2><p className="mt-1 mb-4 text-sm text-ink/50">Create the campaign first, then add Offer Sets and choose which single set customers see.</p>
        <form action={createOfferCampaign} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-ink/70">Campaign title<input name="title" required maxLength={120} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="e.g. Festive Gift Offers" /></label>
          <label className="text-sm text-ink/70">URL slug<input name="slug" maxLength={90} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="festive-gift-offers (optional)" /></label>
          <label className="text-sm text-ink/70 md:col-span-2">Description<textarea name="description" rows={2} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="Short campaign introduction" /></label>
          <label className="text-sm text-ink/70">Creative image URL<input name="creativeImageUrl" type="url" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="https://..." /></label>
          <label className="text-sm text-ink/70">Call-to-action text<input name="ctaText" maxLength={40} defaultValue="Shop the offer" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" /></label>
          <label className="text-sm text-ink/70">Starts at<input name="startsAt" type="datetime-local" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" /></label>
          <label className="text-sm text-ink/70">Ends at<input name="endsAt" type="datetime-local" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" /></label>
          <label className="text-sm text-ink/70">Maximum qualifying orders<input name="maxQualifyingOrders" type="number" min="1" step="1" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="Optional" /></label>
          <div className="flex items-end"><button className="rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-white">Create campaign</button></div>
        </form>
      </section>
      <section className="mb-8 rounded-2xl border border-cream bg-white p-5 shadow-soft">
        <h2 className="font-display text-lg text-ink">Add an Offer Set</h2><p className="mt-1 mb-4 text-sm text-ink/50">Select products and apply a discount, free delivery, a gift, or a combination. Product catalogue prices remain unchanged.</p>
        {campaigns.length ? <form action={createOfferSet} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-ink/70">Campaign<select name="campaignId" required className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5">{campaigns.map((c:any)=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label className="text-sm text-ink/70">Offer Set name<input name="title" required maxLength={100} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="e.g. First 10 orders" /></label>
          <label className="text-sm text-ink/70 md:col-span-2">Products (select one or more)<select name="productIds" multiple required size={Math.min(7, Math.max(3, products.length))} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5">{products.map((p:any)=><option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}</select><span className="mt-1 block text-xs text-ink/45">Use Ctrl (Windows) or Command (Mac) to select multiple products.</span></label>
          <label className="text-sm text-ink/70">Discount percentage<input name="discountPercent" type="number" min="0.01" max="100" step="0.01" className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="Optional" /></label>
          <label className="flex items-center gap-2 self-end rounded-xl border border-cream p-3 text-sm text-ink/70"><input name="freeDelivery" type="checkbox" /> Include free delivery</label>
          <label className="text-sm text-ink/70 md:col-span-2">Gift description<input name="giftDescription" maxLength={180} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" placeholder="Optional gift included with this offer" /></label>
          <label className="text-sm text-ink/70 md:col-span-2">Offer Set description<textarea name="description" rows={2} className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" /></label>
          <div><button className="rounded-xl bg-gold px-5 py-2.5 text-sm font-medium text-white">Add Offer Set</button></div>
        </form> : <p className="text-sm text-ink/50">Create a campaign before adding an Offer Set.</p>}
      </section>
      <section className="space-y-4">
        <h2 className="font-display text-lg text-ink">Your campaigns</h2>
        {campaigns.length ? campaigns.map((campaign:any)=><article key={campaign.id} className="rounded-2xl border border-cream bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-ink">{campaign.title}</h3><span className="rounded-full bg-cream px-2.5 py-1 text-xs text-ink/60">{campaign.status}</span></div><p className="mt-1 text-xs text-ink/45">/offers/{campaign.slug} · {campaign.offerSets.length} Offer Sets · {campaign.qualifyingOrdersCount} qualifying orders</p></div>
          <form action={updateOfferCampaignStatus} className="flex flex-wrap gap-2"><input type="hidden" name="campaignId" value={campaign.id}/><select name="status" defaultValue={campaign.status} className="rounded-lg border border-cream px-2 py-1.5 text-xs"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="PAUSED">Paused</option><option value="ENDED">Ended</option></select><button className="rounded-lg border border-cream px-3 py-1.5 text-xs">Update status</button></form></div>
          {campaign.offerSets.length ? <div className="mt-4 space-y-3">{campaign.offerSets.map((set:any)=><div key={set.id} className="rounded-xl bg-milk p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-ink">{set.title} {campaign.activeOfferSetId===set.id?<span className="ml-1 text-xs text-green-700">· Customer-facing set</span>:null}</p><p className="mt-1 text-xs text-ink/50">{set.products.map((x:any)=>x.product.name).join(", ")}</p></div><form action={activateOfferSet}><input type="hidden" name="campaignId" value={campaign.id}/><input type="hidden" name="offerSetId" value={set.id}/><button className="rounded-lg border border-cream bg-white px-3 py-1.5 text-xs">{campaign.activeOfferSetId===set.id?"Selected":"Show this set"}</button></form></div></div>)}</div> : <p className="mt-3 text-sm text-ink/45">No Offer Sets yet.</p>}
        </article>) : <div className="rounded-2xl border border-dashed border-cream p-8 text-center text-sm text-ink/50">No Offer Campaigns created yet.</div>}
      </section>
    </> : <p className="rounded-xl bg-white p-5 text-sm text-ink/60">You can manage Blog Management here. Offer Campaign controls require Super Admin or Technical Support access.</p>}
  </div>;
}
