"use client";

import { useForm, FormProvider, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { StaffRole } from "@prisma/client";
import { X } from "lucide-react";
import { productSchema, type ProductInput } from "@/lib/validators/product";
import { createProduct, updateProduct } from "@/lib/actions/products";
import { SpecEditor } from "./spec-editor";
import { VariantsSection } from "./variants-section";
import { FeaturedToggles } from "./featured-toggles";
import { ImageUploader } from "./image-uploader";
import { CategorySelect } from "./category-select";
import { useUnsavedChanges } from "@/lib/context/unsaved-changes-context";

type ExistingImage = { id: string; url: string; sortOrder: number };
type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

/** Comma or Enter adds a tag chip; each chip has its own remove button. */
function TagsInput({ control }: { control: ReturnType<typeof useForm<ProductInput>>["control"] }) {
  const [draft, setDraft] = useState("");

  return (
    <Controller
      control={control}
      name="tags"
      render={({ field }) => {
        function addTag(raw: string) {
          const value = raw.trim();
          if (!value) return;
          const existing = field.value ?? [];
          if (!existing.includes(value)) field.onChange([...existing, value]);
          setDraft("");
        }

        return (
          <div>
            <label className="font-body text-sm text-ink/70">Tags</label>
            <p className="text-xs text-ink/40 font-body mb-1">
              Helps customers find this product through search — e.g. &quot;leather&quot;, &quot;everyday&quot;.
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {(field.value ?? []).map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 bg-champagne/30 border border-gold/30 text-ink text-xs font-body px-2.5 py-1 rounded-full"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => field.onChange((field.value ?? []).filter((t) => t !== tag))}
                    className="text-ink/40 hover:text-ink"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(draft);
                }
              }}
              onBlur={() => addTag(draft)}
              placeholder="Type a tag and press Enter..."
              className="w-full rounded-xl border border-cream px-3 py-2 font-body"
            />
          </div>
        );
      }}
    />
  );
}

export function ProductForm({
  role,
  productId,
  defaultValues,
  existingImages,
  categories,
}: {
  role: StaffRole;
  productId?: string;
  defaultValues?: Partial<ProductInput>;
  existingImages?: ExistingImage[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const canSeeFinancials = role === "SUPER_ADMIN";
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      brand: "Giftij Brandy",
      currency: "NGN",
      status: "DRAFT",
      tags: [],
      featuredFlags: [],
      specs: [],
      categoryIds: [],
      hasVariants: false,
      variantType: null,
      variants: [],
      initialStock: 0,
      ...defaultValues,
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = form;

  const { setDirty } = useUnsavedChanges();

  // Feeds the shared context so the sidebar, breadcrumbs, and back link
  // all know to confirm before navigating away — not just this form.
  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty, setDirty]);

  // Covers hard navigation the in-app guard can't catch: closing the tab,
  // refreshing, or typing a new URL directly into the address bar.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function onSubmit(data: ProductInput) {
    setSaving(true);
    setServerError(null);
    try {
      if (productId) {
        await updateProduct(productId, data);
        setDirty(false); // saved — no longer unsaved, don't prompt on the refresh below
        router.refresh();
      } else {
        const id = await createProduct(data);
        setDirty(false); // saved — don't prompt on the redirect to the new product's edit page
        router.push(`/admin/products/${id}/edit`);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const saveLabel = saving ? "Saving..." : productId ? "Save Changes" : "Create Product";

  return (
    <FormProvider {...form}>
      {/* pb-24 on mobile only clears the sticky action bar at the bottom;
          desktop (md:pb-0) is untouched since it has no sticky bar. */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 md:space-y-8 max-w-3xl pb-24 md:pb-0">
        {serverError && (
          <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3">{serverError}</div>
        )}

        {/* Core Details */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Core Details</h2>

          <div>
            <label className="font-body text-sm text-ink/70">Product Name</label>
            <input {...register("name")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">
              URL Slug <span className="text-ink/40">(leave blank to auto-generate from name)</span>
            </label>
            <input {...register("slug")} placeholder="e.g. the-adaeze-tote" className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            {errors.slug && <p className="text-xs text-red-600 mt-1">{errors.slug.message}</p>}
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">Short Description</label>
            <input {...register("shortDesc")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">Full Description</label>
            <textarea {...register("fullDesc")} rows={4} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>

          <CategorySelect categories={categories} />

          <div>
            <label className="font-body text-sm text-ink/70">Brand</label>
            <input {...register("brand")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-body text-sm text-ink/70">SKU</label>
              <input {...register("sku")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
            <div>
              <label className="font-body text-sm text-ink/70">Barcode</label>
              <input {...register("barcode")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Pricing</h2>
          <p className="text-xs text-ink/40 font-body -mt-2">
            One price for the whole product — all variants (if any) share it.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-body text-sm text-ink/70">Selling Price (₦)</label>
              <input type="number" step="0.01" {...register("price")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
              {errors.price && <p className="text-xs text-red-600 mt-1">{errors.price.message}</p>}
            </div>

            {canSeeFinancials ? (
              <div>
                <label className="font-body text-sm text-ink/70">Cost Price (₦)</label>
                <input type="number" step="0.01" {...register("costPrice")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
              </div>
            ) : (
              <div>
                <label className="font-body text-sm text-ink/40">Cost Price</label>
                <div className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-ink/30 bg-cream/30">
                  Visible to Super Admin only
                </div>
              </div>
            )}

            <div>
              <label className="font-body text-sm text-ink/70">Discount (%)</label>
              <input type="number" step="0.01" {...register("discount")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
            <div>
              <label className="font-body text-sm text-ink/70">Currency</label>
              <input {...register("currency")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">Status</label>
            <div className="flex flex-wrap gap-3 mt-1">
              {(["DRAFT", "ACTIVE", "ARCHIVED"] as const).map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-2 rounded-xl border border-cream px-3 py-2 text-sm font-body cursor-pointer has-[:checked]:border-gold has-[:checked]:bg-champagne/30"
                >
                  <input type="radio" value={s} {...register("status")} />
                  {s === "DRAFT" ? "Draft" : s === "ACTIVE" ? "Active" : "Archived"}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Product Specifications */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Product Specifications</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="font-body text-sm text-ink/70">Weight (kg)</label>
              <input type="number" step="0.01" {...register("weight")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
            <div>
              <label className="font-body text-sm text-ink/70">Dimensions</label>
              <input {...register("dimensions")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
            <div>
              <label className="font-body text-sm text-ink/70">Warranty</label>
              <input {...register("warranty")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
          </div>

          <TagsInput control={form.control} />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <SpecEditor control={form.control} register={register} />
        </section>

        {/* Variants / Inventory, then Homepage Placement, then SEO — matching the requested flow order */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <VariantsSection productId={productId} />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <FeaturedToggles control={form.control} />
        </section>

        {/* SEO — standalone, separate from Specifications/Logistics */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">SEO</h2>
          <p className="text-xs text-ink/40 font-body -mt-2">Both optional.</p>
          <div>
            <label className="font-body text-sm text-ink/70">SEO Title</label>
            <input {...register("seoTitle")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>
          <div>
            <label className="font-body text-sm text-ink/70">SEO Description</label>
            <input {...register("seoDescription")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>
        </section>

        {productId && (
          <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
            <ImageUploader productId={productId} initialImages={existingImages ?? []} />
          </section>
        )}

        {!productId && (
          <p className="text-xs text-ink/40 font-body">
            Save the product first to unlock image upload — Cloudinary needs a product to attach images to.
          </p>
        )}

        {/* Desktop: inline button, unchanged. Mobile: hidden here, shown in the sticky bar below instead. */}
        <div className="hidden md:flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gold text-white font-body px-6 py-2.5 disabled:opacity-60"
          >
            {saveLabel}
          </button>
        </div>
      </form>

      {/* Sticky mobile action bar — always visible, no scrolling required to
          save. This button lives outside the <form> element (it has to, to
          be fixed-positioned against the viewport rather than scrolling
          with the form content), so it can't rely on native type="submit"
          form association — it invokes the same submit handler directly. */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-cream p-3">
        <button
          type="button"
          onClick={handleSubmit(onSubmit)}
          disabled={saving}
          className="w-full rounded-xl bg-gold text-white font-body px-6 py-3 disabled:opacity-60"
        >
          {saveLabel}
        </button>
      </div>
    </FormProvider>
  );
}
