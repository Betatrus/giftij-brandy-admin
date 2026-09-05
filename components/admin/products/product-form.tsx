"use client";

import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { StaffRole } from "@prisma/client";
import { productSchema, type ProductInput } from "@/lib/validators/product";
import { createProduct, updateProduct } from "@/lib/actions/products";
import { uploadProductImage, uploadVariantImage } from "@/lib/actions/media";
import { VariantsSection } from "./variants-section";
import { ImageUploader } from "./image-uploader";
import { StagedImagePicker, fileToBase64, type StagedImage } from "./staged-image-picker";
import { CategorySelect } from "./category-select";
import { ProductPreview } from "./product-preview";
import { ProductSaveResultDialog } from "./product-save-result-dialog";
import { useUnsavedChanges } from "@/lib/context/unsaved-changes-context";

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
  // Two-step flow per the confirmed requirement: fill in details, review a
  // customer-facing preview, THEN create. "Edit" from the preview just
  // flips this back — nothing is lost, the form state underneath is
  // untouched either way.
  const [step, setStep] = useState<"form" | "preview">("form");
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  // Keyed by COLOUR (see variant-image-slot.tsx's top comment for why
  // colour, never the full "Colour / Size" combination). Only ever
  // populated for a brand-new product — an existing product's variant
  // images upload immediately on selection instead (VariantImageSlot's
  // EDIT-mode path), so this stays empty whenever productId is set.
  const [stagedVariantImages, setStagedVariantImages] = useState<Record<string, StagedImage>>({});

  function handleStageVariantImage(color: string, file: File) {
    setStagedVariantImages((prev) => {
      const existing = prev[color];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return {
        ...prev,
        [color]: { tempId: `${color}-${Date.now()}`, file, previewUrl: URL.createObjectURL(file) },
      };
    });
  }

  // Shown on the preview/creating screen while images upload right after
  // creation succeeds — "a short delay of a few seconds is completely
  // acceptable," per the confirmed flow, as long as it's ONE continuous
  // process the admin doesn't have to leave and come back to.
  const [uploadStatus, setUploadStatus] = useState<{ done: number; total: number } | null>(null);

  // Set once at the very end of a successful onSubmit — after
  // create/update AND (for a new product) every staged photo upload has
  // fully resolved. Drives the success/partial-failure dialog; null
  // means "don't show it," including for the whole duration any saving/
  // uploading is still in progress.
  const [saveResult, setSaveResult] = useState<
    null | { kind: "created"; productId: string; failedPhotoCount: number } | { kind: "updated" }
  >(null);

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
    trigger,
    getValues,
    watch,
    formState: { errors, isDirty },
  } = form;

  const hasVariants = watch("hasVariants");

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

  // Moves from the form to the preview — only after every field passes
  // validation, so the preview never shows a half-valid product. Nothing
  // is saved yet; this is purely a client-side view switch. If
  // validation fails, this must NEVER just silently do nothing — every
  // field with a problem now shows its own message (see the Variants
  // section and the Core Details/Pricing fields above), and this banner
  // makes sure the admin notices something needs fixing at all, even if
  // the invalid field is scrolled out of view.
  async function handleGoToPreview() {
    setServerError(null);
    const valid = await trigger();
    if (valid) {
      setStep("preview");
    } else {
      setServerError("Please fix the highlighted fields below before continuing.");
    }
  }

  // The ONLY place that actually creates/saves the product — reachable
  // only from the preview screen's "Create Product"/"Save Changes"
  // button, matching "Only after clicking Create Product should the
  // product creation process execute."
  //
  // IMAGE FLOW (new products only): select photos locally -> preview ->
  // Create Product -> product is created -> immediately, in this same
  // action, each staged photo is sent to Cloudinary and attached to the
  // brand-new product. The admin never has to leave this screen or come
  // back later to add photos — the existing Cloudinary
  // architecture/media actions are reused exactly as they are, just
  // called automatically right here instead of requiring a manual
  // second step. If a photo fails to upload, creation still succeeds
  // (the product itself is never lost over a photo problem) and the
  // admin lands on the edit page with a clear, specific warning — where
  // the real ImageUploader is available to retry that exact photo.
  async function onSubmit(data: ProductInput) {
    setSaving(true);
    setServerError(null);
    try {
      if (productId) {
        await updateProduct(productId, data);
        setDirty(false); // saved — no longer unsaved, don't prompt on the refresh below
        router.refresh();
        setSaveResult({ kind: "updated" });
      } else {
        const created = await createProduct(data);
        setDirty(false); // saved — don't prompt on the redirect to the new product's edit page

        // Build the full upload queue up front — general product photos
        // AND staged variant photos — so the progress indicator reflects
        // everything that's about to happen, not just the general
        // gallery. One queue entry per COLOUR (not per size variant
        // sharing that colour): uploadVariantImage takes the whole
        // variantIds group and does one physical Cloudinary upload,
        // fanned out to one ProductImage row per variant — see that
        // action's comment. Queuing one entry per variant here would
        // reproduce the exact duplicate-upload bug this fixes.
        type QueuedUpload = { kind: "product" } | { kind: "variant"; variantIds: string[] };
        const uploadQueue: { file: File; target: QueuedUpload }[] = [];

        for (const staged of stagedImages) {
          uploadQueue.push({ file: staged.file, target: { kind: "product" } });
        }
        for (const [color, staged] of Object.entries(stagedVariantImages)) {
          // Structured `color` is the primary match (see createProduct's
          // return shape in lib/actions/products.ts) — the `value`-based
          // check only still applies to a legacy/Material row without one.
          const variantIdsForColor = created.variants
            .filter(
              (v) => v.color === color || (!v.color && (v.value === color || v.value.startsWith(`${color} / `)))
            )
            .map((v) => v.id);
          if (variantIdsForColor.length > 0) {
            uploadQueue.push({ file: staged.file, target: { kind: "variant", variantIds: variantIdsForColor } });
          }
        }

        let failedCount = 0;
        if (uploadQueue.length > 0) {
          setUploadStatus({ done: 0, total: uploadQueue.length });
          for (let i = 0; i < uploadQueue.length; i++) {
            try {
              const base64 = await fileToBase64(uploadQueue[i].file);
              const target = uploadQueue[i].target;
              if (target.kind === "product") {
                await uploadProductImage({ productId: created.id, fileBase64: base64 });
              } else {
                await uploadVariantImage({ variantIds: target.variantIds, productId: created.id, fileBase64: base64 });
              }
            } catch {
              failedCount++;
            }
            setUploadStatus({ done: i + 1, total: uploadQueue.length });
          }
        }

        // The success/partial-failure dialog takes over from here — no
        // automatic redirect. "Edit Product"/"Review Photos" navigates
        // to the edit page (with the existing ?photosFailed=N banner
        // still intact for a partial failure); "Return to Products"
        // goes to the list. Either way the admin decides, once they've
        // actually seen the result — this must not fire until this
        // exact point, after every staged photo has been uploaded (or
        // failed) to Cloudinary.
        setSaveResult({ kind: "created", productId: created.id, failedPhotoCount: failedCount });
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStep("form"); // a save failure (e.g. Best Sellers cap, slug taken) needs the admin back in the editable form to fix it
    } finally {
      setSaving(false);
      setUploadStatus(null);
    }
  }

  const saveLabel = saving
    ? uploadStatus
      ? `Adding photos (${uploadStatus.done}/${uploadStatus.total})...`
      : "Saving..."
    : productId
    ? "Save Changes"
    : "Create Product";

  if (step === "preview") {
    return (
      <>
        <ProductPreview
          values={getValues()}
          categories={categories}
          existingImages={existingImages}
          stagedImages={stagedImages}
          isEditing={!!productId}
          saving={saving}
          saveLabel={saveLabel}
          serverError={serverError}
          onEdit={() => setStep("form")}
          onConfirm={handleSubmit(onSubmit)}
        />
        <ProductSaveResultDialog
          result={saveResult}
          onPrimaryAction={() => {
            if (saveResult?.kind === "created") {
              router.push(
                `/admin/products/${saveResult.productId}/edit${
                  saveResult.failedPhotoCount > 0 ? `?photosFailed=${saveResult.failedPhotoCount}` : ""
                }`
              );
            } else {
              setSaveResult(null);
              setStep("form"); // "Continue Editing" — back to the editable form, not the read-only preview
            }
          }}
          onReturnToProducts={() => router.push("/admin/products")}
        />
      </>
    );
  }

  return (
    <FormProvider {...form}>
      {/* pb-24 on mobile only clears the sticky action bar at the bottom;
          desktop (md:pb-0) is untouched since it has no sticky bar. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleGoToPreview();
        }}
        className="space-y-6 md:space-y-8 max-w-3xl pb-24 md:pb-0"
      >
        {serverError && (
          <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3">{serverError}</div>
        )}

        {/* Category comes FIRST — it decides how the Variants section below
            behaves (Bags = color only, Shoes/Slippers = color/size), so the
            admin picks it before anything variant-related can make sense. */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">What kind of product is this?</h2>
          <CategorySelect categories={categories} />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Product Details</h2>

          <div>
            <label className="font-body text-sm text-ink/70">Product Name</label>
            <input {...register("name")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">
              URL Slug <span className="text-ink/40">(leave blank to auto-generate from the name)</span>
            </label>
            <input {...register("slug")} placeholder="e.g. the-adaeze-tote" className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            {errors.slug && <p className="text-xs text-red-600 mt-1">{errors.slug.message}</p>}
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">Description</label>
            <textarea {...register("fullDesc")} rows={4} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
            {errors.fullDesc && <p className="text-xs text-red-600 mt-1">{errors.fullDesc.message}</p>}
          </div>
        </section>

        {/* Pricing */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Pricing</h2>
          <p className="text-xs text-ink/40 font-body -mt-2">
            One price for the whole product — every colour/size (if any) sells at this same price.
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
              <p className="text-[11px] text-ink/40 font-body mt-1">
                Customers will see the discounted price automatically — no need to change the price above.
              </p>
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
                  {s === "DRAFT" ? "Draft (hidden from customers)" : s === "ACTIVE" ? "Active (visible to customers)" : "Archived"}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Variants — category-aware (Bags = colour only, Shoes/Slippers = colour and/or size). */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <VariantsSection
            productId={productId}
            categories={categories}
            stagedVariantImages={stagedVariantImages}
            onStageVariantImage={handleStageVariantImage}
          />
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          {productId ? (
            <ImageUploader productId={productId} initialImages={existingImages ?? []} hasVariants={hasVariants} />
          ) : (
            <StagedImagePicker files={stagedImages} onFilesChange={setStagedImages} hasVariants={hasVariants} />
          )}
        </section>

        {/* SEO — standalone, both fields optional, kept because it genuinely helps the admin (search visibility), not decorative */}
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Search Visibility</h2>
          <p className="text-xs text-ink/40 font-body -mt-2">
            Optional — helps customers find this product through Google search.
          </p>
          <div>
            <label className="font-body text-sm text-ink/70">Search Title</label>
            <input {...register("seoTitle")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>
          <div>
            <label className="font-body text-sm text-ink/70">Search Description</label>
            <input {...register("seoDescription")} className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body" />
          </div>
        </section>

        {/* Desktop: inline button, unchanged. Mobile: hidden here, shown in the sticky bar below instead. */}
        <div className="hidden md:flex justify-end">
          <button type="submit" className="rounded-xl bg-gold text-white font-body px-6 py-2.5">
            Preview
          </button>
        </div>
      </form>

      {/* Sticky mobile action bar — always visible, no scrolling required. */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-cream p-3">
        <button
          type="button"
          onClick={handleGoToPreview}
          className="w-full rounded-xl bg-gold text-white font-body px-6 py-3"
        >
          Preview
        </button>
      </div>
    </FormProvider>
  );
}
