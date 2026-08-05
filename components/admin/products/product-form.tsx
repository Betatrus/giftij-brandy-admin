"use client";

import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StaffRole } from "@prisma/client";
import { productSchema, type ProductInput } from "@/lib/validators/product";
import { createProduct, updateProduct } from "@/lib/actions/products";
import { SpecEditor } from "./spec-editor";
import { VariantsSection } from "./variants-section";
import { FeaturedToggles } from "./featured-toggles";
import { ImageUploader } from "./image-uploader";
import { CategorySelect } from "./category-select";

type ExistingImage = { id: string; url: string; sortOrder: number };
type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

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
    watch,
    formState: { errors },
  } = form;

  const hasVariants = watch("hasVariants");

  async function onSubmit(data: ProductInput) {
    setSaving(true);
    setServerError(null);
    try {
      if (productId) {
        await updateProduct(productId, data);
        router.refresh();
      } else {
        const id = await createProduct(data);
        router.push(`/admin/products/${id}/edit`);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-3xl">
        {serverError && (
          <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3">{serverError}</div>
        )}

        {/* Core details */}
        <section className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
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
        <section className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
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
              <label className="font-body text-sm text-ink/70">Status</label>
              <select {...register("status")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body">
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          </div>
        </section>

        {/* Logistics */}
        <section className="bg-white rounded-2xl shadow-soft p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Logistics & SEO</h2>
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
            {!productId && !hasVariants && (
              <div>
                <label className="font-body text-sm text-ink/70">Initial Stock</label>
                <input type="number" {...register("initialStock")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
              </div>
            )}
            <div>
              <label className="font-body text-sm text-ink/70">SEO Title</label>
              <input {...register("seoTitle")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
            <div>
              <label className="font-body text-sm text-ink/70">SEO Description</label>
              <input {...register("seoDescription")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-6">
          <SpecEditor control={form.control} register={register} />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-6">
          <VariantsSection productId={productId} />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-6">
          <FeaturedToggles control={form.control} />
        </section>

        {productId && (
          <section className="bg-white rounded-2xl shadow-soft p-6">
            <ImageUploader productId={productId} initialImages={existingImages ?? []} />
          </section>
        )}

        {!productId && (
          <p className="text-xs text-ink/40 font-body">
            Save the product first to unlock image upload — Cloudinary needs a product to attach images to.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gold text-white font-body px-6 py-2.5 disabled:opacity-60"
          >
            {saving ? "Saving..." : productId ? "Save Changes" : "Create Product"}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
