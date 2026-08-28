"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Trash2, Plus, X } from "lucide-react";
import type { ProductInput, VariantInput } from "@/lib/validators/product";
import { VARIANT_TYPE_PRESETS, OTHER_VARIANT_TYPE } from "@/lib/constants/variant-types";
import { getProductCategoryKind } from "@/lib/constants/product-category-kind";
import type { StagedImage } from "./staged-image-picker";
import { VariantImageSlot } from "./variant-image-slot";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type CategoryOption = { id: string; name: string; slug: string; parentId: string | null };

/**
 * "Has variants?" toggle -> a variant configurator whose SHAPE depends on
 * the product's category (see lib/constants/product-category-kind.ts):
 *
 *   BAG              -> color only (ColorOnlyVariants)
 *   SHOE_OR_SLIPPER  -> color and/or size, combinations auto-generated
 *                       (ColorSizeVariantBuilder)
 *   GENERIC          -> the original free-text variant-type picker, for
 *                       anything outside the three launch categories
 *
 * All three modes write into the same `variants` field array and the same
 * `variantType` string field — the schema doesn't know or care which mode
 * produced a row (see prisma/schema.prisma: ProductVariant.value is a
 * single generic string). This is a deliberate MVP choice: Color+Size
 * combinations are represented as a single concatenated value
 * ("Yellow / 7") rather than two separate columns. Flagged in CHANGES.md
 * as a SCHEMA GAP for the Phase 8 reconciliation (a real two-dimension
 * variant-option model would replace this).
 */
export function VariantsSection({
  productId,
  categories,
  stagedVariantImages,
  onStageVariantImage,
}: {
  productId?: string;
  categories: CategoryOption[];
  // Keyed by COLOUR (never by the full "Colour / Size" combination — see
  // the top comment on VariantImageSlot for why). Only meaningful for a
  // brand-new product; lifted up to product-form.tsx since it needs this
  // map after creation succeeds to upload each staged photo to every
  // real variant ID sharing that colour.
  stagedVariantImages: Record<string, StagedImage>;
  onStageVariantImage: (color: string, file: File) => void;
}) {
  const {
    control,
    watch,
    setValue,
    register,
    formState: { errors },
  } = useFormContext<ProductInput>();

  const hasVariants = watch("hasVariants");
  const categoryIds = watch("categoryIds") ?? [];
  const variants = watch("variants");
  const { fields, append, remove, replace } = useFieldArray({ control, name: "variants" });

  const [confirmDisable, setConfirmDisable] = useState(false);

  const kind = useMemo(
    () => getProductCategoryKind(categories, categoryIds),
    [categories, categoryIds]
  );

  function applyToggle(next: boolean) {
    setValue("hasVariants", next);
    if (!next) {
      setValue("variantType", null);
      setValue("variants", []);
    }
  }

  // Removing rows one at a time (not via the toggle) down to zero should
  // automatically fall back to "no variants." Tracked via a ref of the
  // PREVIOUS fields.length rather than just "is it 0 right now" — the
  // naive version of this effect fired the instant the checkbox was
  // first checked (fields.length is always 0 before any variant row has
  // been added yet), immediately flipping hasVariants back to false and
  // making the checkbox appear unresponsive/unclickable. Only reverts
  // when the count actually transitions from >0 down to 0 — i.e. the
  // admin had at least one variant and removed the last one — never on
  // the initial "just turned variants on" state.
  const prevFieldsLengthRef = useRef(fields.length);
  useEffect(() => {
    const prevLength = prevFieldsLengthRef.current;
    if (hasVariants && prevLength > 0 && fields.length === 0) {
      setValue("hasVariants", false);
      setValue("variantType", null);
    }
    prevFieldsLengthRef.current = fields.length;
  }, [hasVariants, fields.length, setValue]);

  function handleToggleVariants(next: boolean) {
    if (!next) {
      // Only prompt when at least one variant here is a REAL, already-
      // saved row (has a database id from defaultValues) — brand-new,
      // never-saved variant rows can just be cleared silently, there's
      // nothing in the database to lose yet.
      const hasPersistedVariants = (variants ?? []).some((v) => !!v.id);
      if (hasPersistedVariants) {
        setConfirmDisable(true);
        return; // leave the checkbox as-is until the admin decides
      }
    }
    applyToggle(next);
  }

  const persistedVariantCount = (variants ?? []).filter((v) => !!v.id).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-body text-sm font-medium text-ink">Variants</h3>
        <label className="flex items-center gap-2 font-body text-sm text-ink/70">
          <input
            type="checkbox"
            checked={!!hasVariants}
            onChange={(e) => handleToggleVariants(e.target.checked)}
          />
          This product has variants
        </label>
      </div>

      {!hasVariants && (
        <div className="space-y-3">
          <p className="text-xs text-ink/40 font-body">
            Off — this product uses one stock count and one set of product images for the
            whole item.
          </p>
          {!productId ? (
            <div>
              <label className="font-body text-sm text-ink/70">Initial Stock</label>
              <input
                type="number"
                {...register("initialStock")}
                className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body max-w-[200px]"
              />
            </div>
          ) : (
            <p className="text-xs text-ink/50 font-body">
              Stock is managed from the{" "}
              <a href={`/admin/inventory#product-${productId}`} className="text-gold underline">
                Inventory page
              </a>
              , not here.
            </p>
          )}
        </div>
      )}

      {hasVariants && errors.hasVariants && (
        <p className="text-xs text-red-600 mb-2">{errors.hasVariants.message as string}</p>
      )}
      {hasVariants && errors.variants && typeof errors.variants.message === "string" && (
        <p className="text-xs text-red-600 mb-2">{errors.variants.message}</p>
      )}
      {hasVariants && errors.variants && Array.isArray(errors.variants) && errors.variants.some((e) => e) && (
        <p className="text-xs text-red-600 mb-2">
          Every variant needs a name — check the ones outlined in red below.
        </p>
      )}

      {hasVariants && kind === "BAG" && (
        <ColorOnlyVariants
          productId={productId}
          fields={fields}
          variants={variants}
          append={append}
          remove={remove}
          setVariantType={(t) => setValue("variantType", t)}
          stagedVariantImages={stagedVariantImages}
          onStageVariantImage={onStageVariantImage}
        />
      )}

      {hasVariants && kind === "SHOE_OR_SLIPPER" && (
        <ColorSizeVariantBuilder
          productId={productId}
          variants={variants}
          replace={replace}
          setVariantType={(t) => setValue("variantType", t)}
          stagedVariantImages={stagedVariantImages}
          onStageVariantImage={onStageVariantImage}
        />
      )}

      {hasVariants && kind === "GENERIC" && (
        <GenericVariantBuilder
          productId={productId}
          fields={fields}
          variants={variants}
          append={append}
          remove={remove}
          stagedVariantImages={stagedVariantImages}
          onStageVariantImage={onStageVariantImage}
        />
      )}

      <ConfirmDialog
        open={confirmDisable}
        title="Archive all variants?"
        description={`This product has ${persistedVariantCount} saved variant${persistedVariantCount === 1 ? "" : "s"}. Turning off "Has Variants" will archive ${persistedVariantCount === 1 ? "it" : "all of them"} — they'll disappear from this product and the storefront, but their stock history is kept for reporting. The product will start at 0 stock afterward — adjust it from the Inventory page once saved.`}
        confirmLabel="Archive Variants"
        danger
        onConfirm={() => {
          setConfirmDisable(false);
          applyToggle(false);
        }}
        onCancel={() => setConfirmDisable(false)}
      />
    </div>
  );
}

// ============================================================
// BAG MODE — color only
// ============================================================

function ColorOnlyVariants({
  productId,
  fields,
  variants,
  append,
  remove,
  setVariantType,
  stagedVariantImages,
  onStageVariantImage,
}: {
  productId?: string;
  fields: ReturnType<typeof useFieldArray<ProductInput, "variants">>["fields"];
  variants: VariantInput[] | undefined;
  append: ReturnType<typeof useFieldArray<ProductInput, "variants">>["append"];
  remove: ReturnType<typeof useFieldArray<ProductInput, "variants">>["remove"];
  setVariantType: (t: string) => void;
  stagedVariantImages: Record<string, StagedImage>;
  onStageVariantImage: (color: string, file: File) => void;
}) {
  // Bag variants are always "Colour" — set once, no picker shown, so the
  // admin never has to think about variant TYPE, only the color values.
  useEffect(() => {
    setVariantType("Colour");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink/50 font-body bg-champagne/20 border border-gold/20 rounded-xl px-3 py-2">
        Stock will be managed per color below — the product no longer has one combined stock
        count.
      </p>

      <div className="flex items-center justify-between mb-2">
        <label className="font-body text-sm text-ink/70">Colors</label>
        <button
          type="button"
          onClick={() => append({ value: "", sku: "", stock: 0, status: "ACTIVE" })}
          className="text-xs text-gold flex items-center gap-1"
        >
          <Plus size={14} /> Add Color
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-xs text-ink/40 font-body mb-2">
          No colors yet — add at least one (e.g. &quot;Yellow&quot;, &quot;Black&quot;, &quot;Brown&quot;).
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => {
          const color = variants?.[index]?.value ?? "";
          return (
            <VariantRow
              key={field.id}
              index={index}
              valuePlaceholder="Color (e.g. Black)"
              onRemove={() => remove(index)}
              imageSlot={
                <VariantImageSlot
                  label="Photo"
                  productId={productId}
                  variantIds={variants?.[index]?.id ? [variants[index].id!] : []}
                  existingImageUrl={variants?.[index]?.imageUrl}
                  stagedImage={color ? stagedVariantImages[color] : undefined}
                  onStage={(file) => color && onStageVariantImage(color, file)}
                />
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// SHOE / SLIPPER MODE — color and/or size, combinations generated
// ============================================================

function ColorSizeVariantBuilder({
  productId,
  variants,
  replace,
  setVariantType,
  stagedVariantImages,
  onStageVariantImage,
}: {
  productId?: string;
  variants: VariantInput[] | undefined;
  replace: ReturnType<typeof useFieldArray<ProductInput, "variants">>["replace"];
  setVariantType: (t: string) => void;
  stagedVariantImages: Record<string, StagedImage>;
  onStageVariantImage: (color: string, file: File) => void;
}) {
  const [useColor, setUseColor] = useState(true);
  const [useSize, setUseSize] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState("");
  const [sizeDraft, setSizeDraft] = useState("");
  const [seeded, setSeeded] = useState(false);
  // Tracks combinations the admin deliberately removed, so regenerating
  // (e.g. after adding a new colour) never silently resurrects one they
  // took out — the actual fix for "the system should NOT force every
  // theoretical combination if some combinations do not exist" (§4).
  // Without this, generateCombinations() would always rebuild the FULL
  // colour×size cross-product every time it runs, undoing any earlier
  // removal the moment the admin touched the colour/size lists again.
  const [excludedCombos, setExcludedCombos] = useState<Set<string>>(new Set());

  // On first load of an existing product, reconstruct the color/size
  // chip lists by parsing already-saved combination values ("Yellow / 7"
  // -> color "Yellow", size "7"). This is a best-effort MVP heuristic —
  // the database only stores the combined string (see the schema-gap
  // note above), so a product whose variants were entered before this
  // builder existed, or with unusual formatting, may need its chips
  // re-entered manually. It never discards existing variant rows either
  // way; it only seeds the editing UI.
  useEffect(() => {
    if (seeded) return;
    const existing = (variants ?? []).filter((v) => v.value);
    if (existing.length === 0) {
      setSeeded(true);
      return;
    }
    const colorSet = new Set<string>();
    const sizeSet = new Set<string>();
    let anyCombo = false;
    for (const v of existing) {
      if (v.value.includes(" / ")) {
        anyCombo = true;
        const [c, s] = v.value.split(" / ").map((p) => p.trim());
        if (c) colorSet.add(c);
        if (s) sizeSet.add(s);
      }
    }
    if (anyCombo) {
      setUseColor(true);
      setUseSize(true);
      setColors(Array.from(colorSet));
      setSizes(Array.from(sizeSet));
    } else {
      // Single-axis existing data — treat every existing value as a color
      // by default (the common case); the admin can switch to Size if
      // that's what these actually were.
      setUseColor(true);
      setUseSize(false);
      setColors(existing.map((v) => v.value));
    }
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  function addChip(list: "color" | "size", raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (list === "color") {
      if (!colors.includes(value)) setColors([...colors, value]);
      setColorDraft("");
    } else {
      if (!sizes.includes(value)) setSizes([...sizes, value]);
      setSizeDraft("");
    }
  }

  function removeChip(list: "color" | "size", value: string) {
    if (list === "color") setColors(colors.filter((c) => c !== value));
    else setSizes(sizes.filter((s) => s !== value));
  }

  // Existing (already-saved, has an id) rows are matched back in by
  // value string so regenerating doesn't lose their id/sku/stock/image —
  // only brand-new combinations start at 0 stock, and combinations no
  // longer selected are dropped from the array (which the existing
  // create/update diff logic in lib/actions/products.ts then archives,
  // same as manually removing a row).
  function generateCombinations() {
    const existingByValue = new Map((variants ?? []).map((v) => [v.value, v]));
    let combos: string[] = [];

    if (useColor && useSize && colors.length > 0 && sizes.length > 0) {
      for (const c of colors) for (const s of sizes) combos.push(`${c} / ${s}`);
    } else if (useColor && colors.length > 0) {
      combos = [...colors];
    } else if (useSize && sizes.length > 0) {
      combos = [...sizes];
    }

    // Never re-include a combination the admin explicitly removed — see
    // the excludedCombos state declaration above for why this matters.
    combos = combos.filter((value) => !excludedCombos.has(value));

    const nextVariants: VariantInput[] = combos.map((value) => {
      const existing = existingByValue.get(value);
      return existing ?? { value, sku: "", stock: 0, status: "ACTIVE" as const };
    });

    setVariantType(useColor && useSize ? "Colour + Size" : useColor ? "Colour" : "Size");
    replace(nextVariants);
  }

  const canGenerate = (useColor && colors.length > 0) || (useSize && sizes.length > 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink/50 font-body bg-champagne/20 border border-gold/20 rounded-xl px-3 py-2">
        Stock will be managed per combination below — the product no longer has one combined
        stock count.
      </p>

      <div>
        <label className="font-body text-sm text-ink/70 block mb-2">Variant options</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="checkbox"
              checked={useColor}
              onChange={(e) => setUseColor(e.target.checked)}
            />
            Color
          </label>
          <label className="flex items-center gap-2 font-body text-sm">
            <input
              type="checkbox"
              checked={useSize}
              onChange={(e) => setUseSize(e.target.checked)}
            />
            Size
          </label>
        </div>
        {!useColor && !useSize && (
          <p className="text-xs text-red-600 font-body mt-1">Select Color, Size, or both.</p>
        )}
      </div>

      {useColor && (
        <ChipInput
          label="Colors"
          placeholder="Type a color and press Enter — e.g. Yellow"
          values={colors}
          draft={colorDraft}
          onDraftChange={setColorDraft}
          onAdd={(v) => addChip("color", v)}
          onRemove={(v) => removeChip("color", v)}
        />
      )}

      {useSize && (
        <ChipInput
          label="Sizes"
          placeholder="Type a size and press Enter — e.g. 7"
          values={sizes}
          draft={sizeDraft}
          onDraftChange={setSizeDraft}
          onAdd={(v) => addChip("size", v)}
          onRemove={(v) => removeChip("size", v)}
        />
      )}

      {/* One photo PER COLOUR, not per combination — "Yellow" gets one
          photo shared across every size that colour comes in (Yellow/7,
          Yellow/8, ...), never a separate photo per size. In edit mode,
          selecting a photo here uploads it to every real variant ID
          currently sharing that colour (see VariantImageSlot's top
          comment for how, given the schema's one-image-per-variant
          constraint). */}
      {useColor && colors.length > 0 && (
        <div className="space-y-2 pt-1">
          <label className="font-body text-sm text-ink/70">Color Photos</label>
          <p className="text-[11px] text-ink/40 font-body -mt-1">
            One photo per colour — it's used for every size that colour comes in.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {colors.map((color) => {
              const variantIdsForColor = (variants ?? [])
                .filter((v) => v.value === color || v.value.startsWith(`${color} / `))
                .map((v) => v.id)
                .filter((id): id is string => !!id);
              const existingForColor = (variants ?? []).find(
                (v) => v.value === color || v.value.startsWith(`${color} / `)
              );
              return (
                <VariantImageSlot
                  key={color}
                  label={color}
                  productId={productId}
                  variantIds={variantIdsForColor}
                  existingImageUrl={existingForColor?.imageUrl}
                  stagedImage={stagedVariantImages[color]}
                  onStage={(file) => onStageVariantImage(color, file)}
                />
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={generateCombinations}
        disabled={!canGenerate}
        className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-40"
      >
        {useColor && useSize
          ? "Generate Combinations"
          : "Apply " + (useColor ? "Colors" : "Sizes")}
      </button>

      {(variants ?? []).length > 0 && (
        <div className="space-y-3 pt-2">
          <label className="font-body text-sm text-ink/70">
            {useColor && useSize ? "Color / Size Combinations" : useColor ? "Colors" : "Sizes"}{" "}
            <span className="text-ink/40">— set stock for each</span>
          </label>
          {(variants ?? []).map((v, index) => (
            <VariantRow
              key={v.id ?? v.value}
              index={index}
              valuePlaceholder=""
              valueReadOnly
              onRemove={() => {
                // Marks this exact combination as deliberately excluded
                // (see excludedCombos above) BEFORE dropping it from the
                // array — so clicking "Generate Combinations" again,
                // e.g. after adding one more colour, won't bring it back.
                setExcludedCombos((prev) => new Set(prev).add(v.value));
                const next = (variants ?? []).filter((_, i) => i !== index);
                replace(next);
              }}
            />
          ))}
        </div>
      )}

      {excludedCombos.size > 0 && (
        <div className="pt-1">
          <p className="font-body text-xs text-ink/40 mb-1.5">
            Removed — won't be included when you generate combinations again:
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from(excludedCombos).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  // Restore: un-exclude and add it straight back into the
                  // combo list at 0 stock, without requiring a full
                  // regenerate (which could also pull in other, unrelated
                  // new combinations the admin isn't ready for yet).
                  setExcludedCombos((prev) => {
                    const next = new Set(prev);
                    next.delete(value);
                    return next;
                  });
                  replace([...(variants ?? []), { value, sku: "", stock: 0, status: "ACTIVE" as const }]);
                }}
                className="flex items-center gap-1.5 bg-cream/60 text-ink/60 text-xs font-body px-2.5 py-1 rounded-full hover:bg-cream"
              >
                {value} <span className="text-gold">+ Add back</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipInput({
  label,
  placeholder,
  values,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  values: string[];
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  return (
    <div>
      <label className="font-body text-sm text-ink/70">{label}</label>
      <div className="flex flex-wrap gap-2 mt-1 mb-2">
        {values.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 bg-champagne/30 border border-gold/30 text-ink text-xs font-body px-2.5 py-1 rounded-full"
          >
            {v}
            <button
              type="button"
              onClick={() => onRemove(v)}
              className="text-ink/40 hover:text-ink"
              aria-label={`Remove ${v}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            onAdd(draft);
          }
        }}
        onBlur={() => onAdd(draft)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-cream px-3 py-2 font-body text-sm"
      />
    </div>
  );
}

// ============================================================
// GENERIC MODE — original free-text variant-type picker, for products
// outside Bags/Shoes/Slippers (legacy data, or a future 4th category).
// ============================================================

function GenericVariantBuilder({
  productId,
  fields,
  variants,
  append,
  remove,
  stagedVariantImages,
  onStageVariantImage,
}: {
  productId?: string;
  fields: ReturnType<typeof useFieldArray<ProductInput, "variants">>["fields"];
  variants: VariantInput[] | undefined;
  append: ReturnType<typeof useFieldArray<ProductInput, "variants">>["append"];
  remove: ReturnType<typeof useFieldArray<ProductInput, "variants">>["remove"];
  stagedVariantImages: Record<string, StagedImage>;
  onStageVariantImage: (color: string, file: File) => void;
}) {
  const { watch, setValue } = useFormContext<ProductInput>();
  const variantType = watch("variantType");
  const isCustomType = !!variantType && !(VARIANT_TYPE_PRESETS as readonly string[]).includes(variantType);
  const [showCustomInput, setShowCustomInput] = useState(isCustomType);

  function handleTypeSelect(selected: string) {
    if (selected === OTHER_VARIANT_TYPE) {
      setShowCustomInput(true);
      setValue("variantType", "");
    } else {
      setShowCustomInput(false);
      setValue("variantType", selected);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink/50 font-body bg-champagne/20 border border-gold/20 rounded-xl px-3 py-2">
        Stock will be managed per variant below — the product no longer has one combined stock
        count.
      </p>

      <div>
        <label className="font-body text-sm text-ink/70">Variant Type</label>
        <select
          value={isCustomType ? OTHER_VARIANT_TYPE : variantType ?? ""}
          onChange={(e) => handleTypeSelect(e.target.value)}
          className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body bg-white"
        >
          <option value="" disabled>
            Select a variant type...
          </option>
          {VARIANT_TYPE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
          <option value={OTHER_VARIANT_TYPE}>Other (custom)</option>
        </select>

        {showCustomInput && (
          <input
            placeholder="e.g. Strap Length"
            value={isCustomType ? variantType ?? "" : ""}
            onChange={(e) => setValue("variantType", e.target.value)}
            className="w-full mt-2 rounded-xl border border-cream px-3 py-2 font-body"
          />
        )}
      </div>

      {!!variantType && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="font-body text-sm text-ink/70">{variantType} Values</label>
            <button
              type="button"
              onClick={() => append({ value: "", sku: "", stock: 0, status: "ACTIVE" })}
              className="text-xs text-gold flex items-center gap-1"
            >
              <Plus size={14} /> Add {variantType}
            </button>
          </div>

          {fields.length === 0 && (
            <p className="text-xs text-ink/40 font-body mb-2">
              No values yet — add at least one (e.g. &quot;Black&quot;, &quot;42&quot;).
            </p>
          )}

          <div className="space-y-3">
            {fields.map((field, index) => {
              const key = variants?.[index]?.value ?? "";
              return (
                <VariantRow
                  key={field.id}
                  index={index}
                  valuePlaceholder="Value (e.g. Black)"
                  onRemove={() => remove(index)}
                  imageSlot={
                    <VariantImageSlot
                      label="Photo"
                      productId={productId}
                      variantIds={variants?.[index]?.id ? [variants[index].id!] : []}
                      existingImageUrl={variants?.[index]?.imageUrl}
                      stagedImage={key ? stagedVariantImages[key] : undefined}
                      onStage={(file) => key && onStageVariantImage(key, file)}
                    />
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Shared row — image upload + stock. SKU is never shown/typed here (see
// lib/validators/product.ts — auto-generated server-side on save).
// ============================================================

// ============================================================
// Shared row — value + stock inputs. Image handling was moved out to
// VariantImageSlot (see that file's top comment) so the same slot
// component can represent either one variant (here) or a whole colour
// group shared across several sizes (ColorSizeVariantBuilder's dedicated
// "Colour Photos" section). SKU is never shown/typed here (see
// lib/validators/product.ts — auto-generated server-side on save).
// ============================================================

function VariantRow({
  index,
  valuePlaceholder,
  valueReadOnly,
  onRemove,
  imageSlot,
}: {
  index: number;
  valuePlaceholder: string;
  valueReadOnly?: boolean;
  onRemove: () => void;
  imageSlot?: React.ReactNode;
}) {
  const { register, formState: { errors } } = useFormContext<ProductInput>();
  const valueError = errors.variants?.[index]?.value;

  return (
    <div className="border border-cream rounded-xl p-3 flex gap-3 items-start">
      {imageSlot}

      <div className="flex-1 grid grid-cols-2 gap-2">
        <input
          placeholder={valuePlaceholder}
          readOnly={valueReadOnly}
          {...register(`variants.${index}.value` as const)}
          className={`rounded-lg border px-2 py-1.5 text-sm font-body ${
            valueError ? "border-red-400" : "border-cream"
          } ${valueReadOnly ? "bg-cream/30 text-ink/70" : ""}`}
        />
        <input
          type="number"
          placeholder="Stock"
          {...register(`variants.${index}.stock` as const)}
          className="rounded-lg border border-cream px-2 py-1.5 text-sm font-body"
        />
        {valueError && (
          <p className="col-span-2 text-[11px] text-red-600 font-body">
            {(valueError.message as string) ?? "This needs a name."}
          </p>
        )}
      </div>

      <button type="button" onClick={onRemove} className="text-ink/40 hover:text-red-600 shrink-0">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
