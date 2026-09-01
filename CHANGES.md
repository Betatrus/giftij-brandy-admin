## Phase 9: Color x Size structured variant fields

Implements the master prompt's Phase 9 Color x Size Variant Architecture — a surgical,
additive schema change, not a redesign. Full report below follows the requested format.

### A. Inspection summary

Confirmed the repository matches the handoff description: `ProductVariant.value` was the
single free-text column representing a variant's label, with Color+Size combinations
stored as the joined string `"Yellow / 16"`. Three places reconstructed color from that
string via `.split(" / ")` or `.startsWith(`${color} / `)`: the admin edit-form's
color/size chip-seeding effect, the "Color Photos" grouping filter, and the post-create
image fan-out — all three in `components/admin/products/variants-section.tsx` and
`components/admin/products/product-form.tsx`. `ProductVariant.id` was, and remains,
the sole transactional identity referenced by `OrderItem.variantId`, stock functions,
and the Paystack webhook — none of those files touch `.value` at all, confirmed by
`grep`, so none needed to change.

### B. Files changed

- `prisma/schema.prisma` — added `color String?` / `size String?` to `ProductVariant`.
- `prisma/migrations/20260901120000_add_variant_color_size/migration.sql` — new migration,
  additive only.
- `prisma/backfill-variant-color-size.ts` — new one-time backfill script (+ its
  `prisma:backfill-variant-color-size` npm script).
- `lib/validators/product.ts` — `variantSchema` gets optional `color`/`size`; added a
  refinement requiring both on every row when `variantType === "Colour + Size"`.
- `lib/actions/products.ts` — new `deriveVariantColorSize` / `deriveVariantValue` helpers;
  wired into `createProduct`, `updateProduct`, `duplicateProduct`; `createProduct`'s
  return shape now includes `color` per variant.
- `lib/api/public-product-select.ts` — public variant select/DTO now includes `id`,
  `color`, `size` (also fixed a pre-existing gap: `id` wasn't exposed on the detail
  endpoint's variants at all before this).
- `components/admin/products/variants-section.tsx` — `ColorSizeVariantBuilder`'s
  combination generator now carries structured `color`/`size` per row instead of only a
  joined string; the color/size chip-seeding effect prefers structured data with a
  legacy-parse fallback; the "Color Photos" grouping filter matches on `color` first;
  `excludedCombos` now stores each removed combo's color/size so "Add back" doesn't need
  to re-derive them.
- `components/admin/products/product-form.tsx` — the post-create image fan-out matches
  newly-created variants by `color` first.
- `app/admin/products/[id]/edit/page.tsx` — passes `color`/`size` through into the edit
  form's `defaultValues` (previously dropped, which would have starved the seeding effect
  above of any structured data to prefer).
- `package.json` — added the backfill script entry.

### C. Database migration

Additive only: `ALTER TABLE "ProductVariant" ADD COLUMN "color" TEXT, ADD COLUMN "size" TEXT;`
Both nullable, no default constraint beyond NULL, no existing column/index/constraint
touched, no data moved. No new indexes added — nothing in the current codebase queries
variants by `color`/`size` yet (all current lookups are by `productId` with the full
variant list already loaded, or by `variantId` directly), so per the master prompt's
own instruction ("only add indexes if justified by actual query patterns, don't add
unnecessary ones") this is deferred until a real query pattern needing one exists —
most likely when the storefront's Color -> Size -> variant lookup is actually built.

### D. Existing-data backfill

`prisma/backfill-variant-color-size.ts` — for every existing variant lacking color/size
(re-run safe: it never overwrites a row that already has either set):
- `value` containing `" / "` -> split into `color`/`size` (this is the one place a split
  is legitimate — it's a one-time historical migration of already-existing data, not a
  live business-logic dependency).
- Otherwise, single-axis `value` -> resolved via the parent Product's `variantType`
  ("Colour" -> `color`; "Size" -> `size`) rather than guessed from the string alone.
- Anything else (Material/custom variantType, or an unrecognized single-axis string) is
  left as `color = null, size = null` and logged as a count for manual review, rather than
  guessed.

Confirmed the backfill script only ever writes `color`/`size` — it does not read or
write `id`, `sku`, `value`, any of the five stock fields, `status`, `image`, `history`,
or anything outside `ProductVariant`.

### E. Product form

Preserved: the two-step form -> preview -> create flow, the staged/immediate image
upload split between create and edit mode, SKU auto-generation, sparse-combination
handling (`excludedCombos`), stock inputs, and the overall visual structure — none of
that changed. What changed is only the *data* the Color+Size builder now attaches to
each row (`color`/`size` alongside `value`) and which field the color-grouping/fan-out
logic matches on. `ColorOnlyVariants` (Bags) and `GenericVariantBuilder` (Material/
custom/legacy) needed no UI changes at all — the server infers color-only/size-only for
those from the product's `variantType` being a direct one-to-one mapping of the single
`value` field, which is a field lookup, not string parsing.

### F. API

Public variant shape (`GET /api/v1/public/products/[slug]`) now returns, per variant:
```json
{
  "id": "variant-id",
  "sku": "GB-PEDRO-YELLOW-16",
  "color": "Yellow",
  "size": "16",
  "value": "Yellow / 16",
  "inStock": true,
  "image": "https://..."
}
```
`sku`, `value`, `inStock`, `image` are unchanged; `id`, `color`, `size` are new.

### G. Stock protection

`currentStock`/`reservedStock`/`soldStock`/`damagedStock`/`returnedStock`/
`lowStockThreshold` are not referenced anywhere in this change outside their existing,
unmodified code paths (`adjustVariantStock`, `checkStockAvailability`,
`deductStockForOrder`, `cancelOrder` in `lib/orders/stock.ts` / `lib/actions/inventory.ts`
/ `lib/actions/orders.ts` — none of those files were touched; confirmed via grep that none
of them reference `.value` at all, since they always operate on `variantId`).
`updateProduct`'s per-variant `update()` call writes only `value`, `color`, `size`,
`status` — the same fields it already wrote before this change, plus the two new ones;
stock changes still go exclusively through `adjustVariantStock`, which this task did not
touch.

### H. Cloudinary / images

Unchanged: staged-selection-then-upload-on-create flow for new products, immediate
fan-out upload for existing products, `ProductImage.variantId`'s 1:1 constraint, and the
"one photo per colour, fanned out to every variant ID sharing that colour" approach
(documented as SCHEMA GAP #19 above — still not resolved by this pass, since the master
prompt scoped that as a separate future improvement, not part of Color+Size). What
changed is only which field the fan-out and grouping logic matches variants by: `color`
first, falling back to the old `value`-based check only for a variant that predates the
backfill (defensive, not the intended steady-state path).

### I. Best Sellers

Not touched. `lib/actions/best-sellers.ts` and `lib/best-sellers/enforce-cap.ts` don't
reference `.value`, `color`, or `size` in any way (confirmed via grep) and were not
edited. No Best Seller UI changes (e.g. the separately-noted Bags-tab gap) were mixed
into this task, per the master prompt's explicit instruction to keep that a separate
Phase 9 item.

### J. Backward compatibility

Color-only, Size-only, Material/custom, and existing Color+Size products all continue to
work without recreation: `deriveVariantColorSize` only fills `color`/`size` from
structured input or from a direct `variantType` mapping — a Material/custom product's
variants keep `color = null, size = null` and `value` stays exactly what the admin typed,
same as before this change.

### K. Build result

**Not run.** This session has no network egress and no `node_modules` (the handoff ZIP
intentionally excludes it, per its own instructions, and `npm install` cannot reach the
registry in this sandboxed environment). `npm run build` needs to be run locally or in CI
before this is merged — this is flagged explicitly rather than claimed as passing, per
the master prompt's own "do not declare success if the build was not actually run" rule.
Recommend: `npm install`, `npx prisma generate`, `npx prisma migrate dev` (or `deploy`)
against a real database, `npm run prisma:backfill-variant-color-size`, then
`npm run build`.

### L. Remaining Phase 9 work

**Completed:** schema + migration, backfill script, product create/update/duplicate write
paths, admin Color+Size builder, public API exposure, edit-form data plumbing.

**Intentionally deferred (this task, by design):**
- The stock race condition noted in a previous inspection — explicitly out of scope
  per the master prompt (§20).
- New DB indexes on `(productId, color)` / `(productId, color, size)` — no current query
  needs them yet (see §C above); add when the storefront's real query pattern lands.
- `VariantColorGroup`-style dedicated color-image model (SCHEMA GAP #19, pre-existing) —
  the master prompt explicitly scoped this out of Color+Size.

**Separate, not-yet-started Phase 9 tasks (explicitly out of scope for this pass):**
- Best Sellers Bags-tab UI verification/addition.
- Desktop admin notifications.
- Storefront-side Color -> Size -> variant selection UI and low-stock/out-of-stock
  messaging (this repo now exposes the structured data the storefront needs for that;
  the storefront itself lives outside this repository).

### Testing Checklist

Everything below is a **plan**, not a completed test — untestable in this sandbox
without a database or `node_modules`. Before merging, verify:

1. `npm run build` passes.
2. Create a Shoe/Slipper with Colour+Size — Yellow/Red x 16/17/18, excluding Red/17 —
   confirm exactly those 5 combinations save with correct `color`/`size`, and Red/17
   does not exist.
3. Set per-combination stock (Yellow/16=3, Yellow/17=5, Yellow/18=0, Red/16=4, Red/18=2),
   simulate a Yellow/17 x2 order via `adjustVariantStock`/order flow, confirm only
   Yellow/17 changes (5 -> 3) and every other combination's stock is untouched.
4. Confirm the public API returns `id`/`color`/`size` alongside the existing fields for
   each variant.
5. Confirm Yellow's color photo still fans out to Yellow/16, Yellow/17, Yellow/18 (and
   Red's to Red/16, Red/18) after creation and after edit.
6. Open an existing (pre-Phase-9) Colour+Size product created before this change —
   confirm color/size seed correctly after running the backfill script, and that stock/
   SKU/images are all still correct.
7. Confirm a Bag (Colour-only), a Size-only product, and a Material/custom product all
   still save and edit correctly with no forced recreation.
8. Confirm Best Sellers still loads and behaves identically for Bags/Shoes/Slippers.

---

## Build fix: stale `productId`/`variantId` props on `VariantRow`

Real `npm run build` reported a genuine TypeScript error (not a static/balance check —
these only catch structural issues, not type mismatches like this one):

```
./components/admin/products/variants-section.tsx:281:15
Type error: Type '{ ...; productId: string | undefined; variantId: string | undefined; ... }'
is not assignable to type '{ index: number; ...; imageSlot?: ReactNode; }'.
Property 'productId' does not exist on type '...'
```

### Investigation (as required, before any fix)

1. **Why were `productId`/`variantId` being passed to `VariantRow`?** — Leftovers from
   before the staged-image-picker refactor (this session's earlier work), when
   `VariantRow` handled its own inline image upload logic directly and genuinely needed
   both values.
2. **Does the current variant-image architecture require them on `VariantRow`?** — No.
   Once image handling was extracted into the new `VariantImageSlot` component,
   `VariantRow`'s responsibility narrowed to just the value/stock inputs, per-row
   validation error display, and the remove button — confirmed by reading its current
   prop type, which has never included `productId`/`variantId` since that refactor.
3. **Is `VariantRow` supposed to use these for existing-image display?** — No — that's
   entirely `VariantImageSlot`'s job now, and it already receives its OWN correctly-typed
   `productId`/`variantIds`/`existingImageUrl` props a few lines below in the exact same
   JSX block, unaffected by this fix.
4. **Did they become stale during the recent refactor?** — Yes, confirmed exactly: when
   `imageSlot={<VariantImageSlot .../>}` was added to this one call site (inside
   `ColorOnlyVariants`, the Bags-mode builder), the two now-orphaned props from the
   pre-refactor version were left behind by mistake. Checked the other two `<VariantRow>`
   call sites in the same file (the Color+Size combination rows, and `GenericVariantBuilder`)
   — both were already correct; this was the only stale instance.

### Fix

Removed `productId={productId}` and `variantId={variants?.[index]?.id}` from the single
`<VariantRow>` call inside `ColorOnlyVariants`. Nothing else changed — `VariantImageSlot`'s
own `productId`/`variantIds` props on the very same JSX block are completely untouched, so
none of the established variant-image behavior is affected:
- Staging locally before creation — unaffected (driven by `VariantImageSlot`'s own props).
- Uploading to Cloudinary only after creation succeeds — unaffected.
- One image per colour, fanned out to every size sharing that colour — unaffected (that
  logic lives in `VariantImageSlot` and `product-form.tsx`'s upload queue, neither touched).
- "Additional Photos" staying separate from colour photos — unaffected (different
  components entirely).
- Existing variant images displaying on edit — unaffected (`existingImageUrl` prop,
  untouched).

### Files Modified

`components/admin/products/variants-section.tsx` (2 lines removed, 1 call site).

### Verification performed

- Re-checked all three `<VariantRow>` call sites against `VariantRow`'s actual prop type —
  now all three match exactly.
- Re-checked all three `<VariantImageSlot>` call sites against its prop type — all three
  already matched and remain correct.
- Re-checked `ColorOnlyVariants`/`ColorSizeVariantBuilder`/`GenericVariantBuilder`'s own
  prop types against how `VariantsSection` calls each of them — all match.
- Re-checked `VariantsSection`'s own props against `product-form.tsx`'s call, including
  `onStageVariantImage`'s function signature against `handleStageVariantImage`'s actual
  definition — matches exactly.
- Full project brace/paren balance sweep (135 files) — clean.
- "use server" export-safety sweep — clean.

This was a genuine type-level bug my structural checks cannot catch on their own (they
verify balanced braces/parens, not prop-type compatibility) — the real compiler caught
what static inspection alone could not. No other instance of this exact mistake was found
anywhere else in the file or project.

### Documentation Updated

This file only.

---

## Phase 8 — Final Refinement Pass (build fix, variant image staging, notifications)

No schema changes. Every item below is a targeted fix against the existing architecture —
nothing was redesigned.

### 1. Build error — fixed

`app/api/webhooks/paystack/route.ts:155` — `Type 'Record<string, unknown> | undefined' is
not assignable to type 'InputJsonValue | null | undefined'`. Root cause: `shippingAddress`
is statically typed as `Record<string, unknown> | undefined` (it's whatever `JSON.parse()`
gave us from the webhook body — see the file's own ASSUMED PAYLOAD CONTRACT comment).
TypeScript can't structurally verify a generic `Record` with `unknown`-typed values
satisfies Prisma's recursive `InputJsonValue` union, even though at runtime this IS valid
JSON. Fixed with `shippingAddress as Prisma.InputJsonValue | undefined` at the exact call
site — Prisma's own exported type for exactly this situation, not `any`, and not a
database change. `findOrCreateCustomerByEmail`'s own parameter type was already correct
(`Prisma.InputJsonValue | null`); only the call site needed the cast. Verified the
customer address/location capture flow is otherwise unchanged and intact — `country`
extraction, the `handleChargeFailed` path (never touched, no address to capture on a
failed charge), and every other call site all inspected and confirmed unaffected.

Also checked a second, superficially similar spot — `Order.shippingAddress`'s own
`as object` cast a few lines later in the same function — since the build error only
named line 155, and re-deriving why confirms `as object` is a different (already
type-compatible) pattern here, it was deliberately left untouched.

### 2/3. Variant images — staged locally with immediate preview, associated by COLOUR not combination

Previously, a variant row said "You'll be able to add a photo for this option once the
product is created" — replaced with the requested flow:

**Select locally → preview immediately → create the product → upload to Cloudinary right
after, in the same continuous action → associate with the correct variant(s).**

- New `components/admin/products/variant-image-slot.tsx` — one image slot that behaves
  differently depending on whether the product exists yet: CREATE mode stages the file
  locally (immediate blob preview, nothing touches Cloudinary); EDIT mode uploads
  immediately via the EXISTING `uploadVariantImage` action (unchanged — it already
  deletes/replaces the previous Cloudinary asset on re-upload, satisfying "update/delete/
  replace... as appropriate" with no changes needed there).
- **Colour, not combination**: for Shoes/Slippers' Color+Size builder, there is now ONE
  photo slot per COLOUR (a new "Color Photos" section, shown once colours are entered),
  not one per "Yellow / 7" combination. Selecting a photo for "Yellow" — in edit mode —
  uploads it to EVERY real variant ID currently sharing that colour (Yellow/7, Yellow/8,
  Yellow/9, ...). This is necessary rather than optional: `ProductImage.variantId` is a
  real one-to-one unique constraint in the schema (confirmed by inspection, not assumed),
  so "one photo shared by several variants" isn't directly representable as a single row —
  the fan-out (uploading the same file once per variant sharing that colour) is the correct
  way to achieve "Yellow image → Yellow variants" within the existing schema, without a
  schema change. Documented as a Phase 9 candidate below (a proper colour-group image
  concept would remove the need to fan out).
- For Bags (colour-only, no size dimension) and any GENERIC custom variant type, each row
  already IS one colour/value, so this is just the direct one-slot-per-row case — no
  fan-out needed there.
- `lib/actions/products.ts`'s `createProduct()` now returns the created variants (id +
  value), not just the product id — the form needs this to know which real variant IDs
  were just created for each colour, in order to fan out staged photos correctly right
  after creation. The only call site (`product-form.tsx`) was updated to match.
- `product-form.tsx`'s `onSubmit` builds one combined upload queue (general product
  photos + every staged variant photo, expanded across all variants sharing each colour)
  and works through it with a live "Adding photos (n/total)..." indicator, exactly like
  the general gallery's existing flow. **Abandoned staged images are never uploaded** —
  they're plain in-memory `File`/blob-URL objects until this point; if the admin never
  clicks Create Product, nothing was ever sent anywhere.
- **Real pre-existing bug found and fixed while doing this**: an existing product's
  already-uploaded variant images were NEVER shown when editing — the image display state
  only ever reflected an upload made in the current session, with no path for loading what
  was already there. Fixed by threading the variant's existing image URL through
  `variantSchema` (a new, display-only `imageUrl` field — never sent back to the server;
  confirmed both `createProduct` and `updateProduct` only ever pick out
  `value`/`sku`/`stock`/`status` from parsed variants, so this addition can't accidentally
  try to write a non-existent column) and the edit page's data loading.

### 4. Product photo section wording — updated, not redesigned

`components/admin/products/staged-image-picker.tsx` (create) and `image-uploader.tsx`
(edit) both now accept a `hasVariants` flag and show different copy: "Product Photos /
Upload the main product photo and add additional photos if needed" when there are no
variants, or "Additional Photos / Optional extra angles that aren't tied to a specific
colour or size" when variants are enabled. The section itself — its mechanics, its
position in the form, the fact that it's optional — is completely unchanged; only the
heading and description text are conditional now.

### 5. Best Sellers — real bug found: an archived category's whole section could vanish

Re-verified the Bags/Shoes/Slippers query end to end. Found that `getBestSellerAllocation`
only showed a category's section at all when that category was `isActive: true`. Since
Bags/Shoes/Slippers can be archived (a deliberate, reversible action — see the Category
Management page built earlier) but must always remain manageable here regardless, an
accidentally-archived "Bags" (e.g., from testing the archive feature) would make the ENTIRE
Bags section silently disappear from Best Sellers — matching exactly the reported symptom.
Fixed: the three core categories' sections now always render regardless of active status,
with a clear amber note and a link to Categories whenever one is currently archived. Cap
enforcement (2/1/1/4, server-side, shared between the picker and the product form) is
unaffected and untouched — verified still correct for all three categories.

### 6. Mobile responsive behavior — verified, no changes needed

Checked every table-based list in the admin (Orders, Customers, Staff, Products,
Categories, all four Report tabs) — every single one already wraps its desktop `<table>`
in a `hidden md:block` container with a matching `md:hidden` card layout alongside it.
Nothing was genuinely missing or inaccessible on mobile; no changes made, per "only fix
something if information is genuinely missing."

### 7. Notifications — "New order received" built, not a full audit system

The notification bell (mobile top bar) was a non-functional placeholder — its own code
comment said so. Built a real, minimal version:
- `lib/actions/notifications.ts`'s `getNewOrderNotifications()` reuses a signal that
  already exists and already means exactly "a new order nobody has looked at yet": an
  Order sits at PENDING only until an admin opens it, at which point it's automatically
  moved to PROCESSING (see `lib/actions/orders.ts`'s `getOrder()`, built in Phase 2, itself
  unchanged). No new "seen" tracking, no new model — the count and list of PENDING orders
  IS the new-order notification.
- `components/admin/notification-bell.tsx` — a real dropdown showing "New order received"
  per pending order with the order number and customer name, each linking straight to that
  order, plus a "View All Orders" link. A badge shows the live count. Refreshes on open and
  every 60 seconds — deliberately not a websocket/real-time push system, which would be
  more infrastructure than this targeted fix calls for.
- Wired into the existing mobile top bar (the only place a notification affordance already
  existed) — no new desktop header/chrome was added, since that would be new UI surface,
  not a targeted refinement of what's there.
- Explicitly NOT built: any other notification type, a persistent "read" state, or staff
  activity logging (e.g. "Support Admin processed offline sale") — all confirmed as Phase 9
  scope and untouched.

### 8. Dark Mode — confirmed still untouched

Re-ran a project-wide search for `dark:` classes — zero results, same as the prior pass.
No dark-mode work was done.

### 9. Damaged Stock — reconfirmed absent from every new/changed file

Swept the entire project again. The only matches are the pre-existing `DAMAGE` stock-
adjustment type and its `computeStockDelta` logic — both predate this entire UI refinement
effort (part of the original Milestone 2 build) and are a different, already-established
business rule, not something inferred from the reference screenshot. No new damaged-stock
field, calculation, UI element, or export column exists anywhere.

### 10. Category system — confirmed no expansion, no schema complexity added

No changes made to category architecture this pass, per explicit instruction not to
introduce a category-configuration system now. The product-level variant selection
(No variants / Color / Size / Material / Color + Size) already covers the MVP need, exactly
as confirmed.

### Files Added

`components/admin/products/variant-image-slot.tsx`, `lib/actions/notifications.ts`,
`components/admin/notification-bell.tsx`.

### Files Modified

`app/api/webhooks/paystack/route.ts`, `lib/customers/identity.ts` (type reference only, no
behavior change from the build fix), `lib/validators/product.ts`,
`lib/actions/products.ts`, `app/admin/products/[id]/edit/page.tsx`,
`components/admin/products/variants-section.tsx`, `components/admin/products/product-form.tsx`,
`components/admin/products/staged-image-picker.tsx`, `components/admin/products/image-uploader.tsx`,
`lib/actions/best-sellers.ts`, `components/admin/best-sellers/best-seller-picker.tsx`,
`components/admin/mobile-topbar.tsx`.

### Files Deleted

None.

### Database Changes

None.

### SCHEMA GAPS — new item this pass

19. **Colour-group product images** — `ProductImage.variantId` is a strict 1:1 unique
    relation, so "one photo shared by several size variants of the same colour" is
    achieved by uploading the same file once per variant (a fan-out), not by a single
    shared image record. A proper `VariantColorGroup` (or similar) concept — one image
    record per colour, referenced by every size variant sharing it — would remove the
    duplication and is a reasonable Phase 9/reconciliation candidate. Not built now; the
    current fan-out approach is correct and functional, just not storage-optimal.

### Testing Checklist

1. `npm run build` — this is the one that matters most this round.
2. Create a Bag with two colours, each with a locally-selected photo — confirm both
   previews appear immediately, confirm both photos are attached correctly after clicking
   Create Product.
3. Create a Shoe with Color+Size, add photos in the new "Color Photos" section for two
   colours, generate combinations — confirm both colours' photos end up on ALL of their
   respective size variants after creation (e.g. Yellow's photo on Yellow/7 AND Yellow/8).
4. Edit an existing variant product created before this pass — confirm its previously-
   uploaded variant images NOW display correctly (they wouldn't have before this fix).
5. Toggle "Has variants" on — confirm the photo section relabels to "Additional Photos"
   with the new description; toggle off — confirms it reverts.
6. Archive "Bags" from Categories, then open Best Sellers — confirm the Bags section still
   appears with an amber note and a working link back to Categories; reactivate and confirm
   the note disappears.
7. Trigger a test PENDING order (Paystack test webhook) — confirm the mobile notification
   bell shows a badge and "New order received" with a working link; open that order and
   confirm the badge count drops on the next refresh (since viewing moves it out of
   PENDING).
8. Confirm no "Damaged" anything appears anywhere in Inventory.

### Suggested Git Commit Messages

```
fix(webhooks): cast shippingAddress to Prisma.InputJsonValue, fixing the build error

feat(products): stage variant photos locally with immediate preview, upload after creation

feat(products): one photo per colour for Color+Size variants, fanned out to every size sharing that colour

fix(products): existing variant images now display when editing (previously never loaded)

feat(products): relabel the photo section to "Additional Photos" when variants are enabled

fix(best-sellers): archived core categories no longer disappear from the picker

feat(notifications): real "New order received" bell reusing the existing PENDING-order signal
```

### Documentation Updated

This file only.

---

## Phase 8 — Completion Pass (Dashboard comparisons, Customer location/export, Inventory expand, Category flow)

Real npm run build confirmed passing before this pass began. No schema changes — every
item below either reuses existing schema fields that were sitting unused, or is
documented as requiring reconciliation rather than worked around.

### 1. Category creation — re-traced, hardened; new business-language explainer

Re-traced the entire pipeline again from scratch. The create logic was already correct
after the prior pass's fixes. Added a small but real improvement: the button now shows
"Adding..." while the request is in flight (previously gave no visual feedback that a
click had registered at all, which — combined with any network latency — could read as
"nothing happened").

**On the richer "Add Category → does it have variants? → variant type → variant values"
flow requested**: built as far as it can safely go without fabricating storage. `Category`
has no field to persist a variant configuration, and per instruction — "do not invent a
fragile workaround... document it" — no such field was added, and no UI was built that
would collect this information and then silently discard it (that would be exactly the
"fake control that does nothing" anti-pattern this whole correction series has been
fixing). Instead:
- Category creation stays a single, real, working step (name only).
- A plain-language note now sits right under the create button explaining how variant
  behavior actually works today for a new category: **the admin chooses Color, Size,
  Material, or Color + Size right on the product form** when adding a product to that
  category — using the existing "GENERIC" variant configurator
  (`lib/constants/product-category-kind.ts` already falls back to this picker for any
  category outside Bags/Shoes/Slippers, unchanged, already built). This is a real,
  working answer to "how do I vary products in a new category," just configured
  per-product rather than once per-category.
- Documented below as the schema reconciliation item it actually is: a
  `Category.variantConfig` (or similar) field, so a Super Admin could set a category's
  variant dimensions ONCE rather than every admin re-choosing per product.

### 2. Best Sellers — reconfirmed complete, not deferred

Already finished in the prior correction pass (Draft products visible with a status note,
cap enforcement counting the same set the picker displays, business-language explainer at
the top). Re-verified against this round's exact wording — no changes needed.

### 3. Inventory UI — expandable variants added

The stock breakdown grid, stock status, category, image, and "Updated X ago" were already
in place. Added the one explicitly-called-out missing structural idea: **expandable
variants**. A product with variants now shows a collapsed "Show N variants" toggle by
default; expanding reveals the same variant table/list as before (desktop table, mobile
stacked list), with a "Variants (N)" label. Non-variant products are unaffected — there
was nothing to collapse for them. No new inventory business rules were introduced —
Restock/Offline Sale/Correction semantics are completely untouched by this UI change, and
"Damaged Stock" was re-confirmed absent from every file touched.

### 4. Stock status — reconfirmed untouched

No changes. The 70%/90% percentage rule combined with an absolute floor for small
quantities (`lib/utils/stock-status.ts`) is unchanged from when it was built.

### 5. Report export — reconfirmed working, styling already fixed prior pass

No further changes needed to the report tabs themselves. The shared `ExportCsvButton` did
need a real fix this pass — see item 7 below (Customer export) for why — which
incidentally makes all four report tabs' buttons slightly more correct too (they now
properly `await` their export function, though theirs were already synchronous so this
was a safety improvement, not a bug fix for them specifically).

### 6. Settings — reconfirmed: Change Password (both roles) already done; Notifications wording

No changes needed to Change Password — built in the prior pass, works for both roles.
Notifications copy already matched the requested business language ("Get alerts when
customers place orders, payments are received, or important order updates occur") from
the prior pass; left as "Not available yet" since there is still no schema field to
persist a preference.

### 7. Customer data & CSV export — NEW, built this pass

**Found a real, pre-existing gap while implementing this**: `Customer.address` and
`Customer.country` already existed in the schema (added well before this phase, presumably
for exactly this purpose) but were NEVER being written to anywhere — the Paystack webhook
captured a full `shippingAddress` on each `Order` but never copied any of it onto the
`Customer` record itself. Fixed:
- `lib/customers/identity.ts`'s `findOrCreateCustomerByEmail()` now accepts and stores
  `address`/`country`, refreshing them on every order (a delivery address is naturally the
  MOST RECENT one, unlike `phone`/`name` which only backfill if missing).
- `app/api/webhooks/paystack/route.ts`'s `handleChargeSuccess` now passes the order's
  `shippingAddress` through. `handleChargeFailed` is untouched (a failed charge has no
  delivery address to capture).
- `lib/actions/customers.ts` gained a `formatLocation()` helper (tolerant of whatever
  shape the storefront's shipping form actually sends) and now returns `location` from
  both `listCustomers()` and `getCustomer()`.
- `customer-table.tsx`/`customer-detail.tsx` display phone and location.
- **New `exportCustomers()` action** and an **Export CSV button directly on the Customers
  page** (not just buried in the Reports tab) — columns: Name, Email, Phone, Location,
  Number of Orders, Total Spent, First Purchase, Last Purchase. Respects the page's own
  active Search/Lifecycle filters exactly like every other export in this project — never
  the whole table when a filter is active.
- **Real bug caught and fixed while wiring this**: the Customers export needed to `await`
  a Server Action (fetching the full filtered set fresh, since the on-screen list is
  paginated), but the shared `ExportCsvButton` only supported a synchronous `onExport`,
  meaning a rejected promise would NOT have been caught by its try/catch, and the
  "Downloaded" success state would have shown immediately, before the real request even
  finished. Fixed `ExportCsvButton` to properly `await` `onExport` (sync or async) and
  added a "Preparing..." loading state for the async case's real round-trip latency.
- No fake/manual customer entry exists anywhere — `findOrCreateCustomerByEmail` remains
  the only way a `Customer` row is ever created, and it's only ever called from the
  Paystack webhook.

### 8. Dashboard comparison — NEW, built this pass

`app/admin/dashboard/page.tsx` was, on inspection, an entirely unwired placeholder scaffold
predating Orders even existing (its own code comment said so) — every "Orders Today,"
"Revenue," "Gross Profit," "Net Profit" card showed a literal "—" with no query behind it
at all. Rebuilt with real data:
- New `lib/actions/dashboard.ts`'s `getDashboardOverview()` — reuses the same
  `getUnifiedSalesLines()` that powers Reports/Analytics (Phase 4/5), so the dashboard can
  never quietly disagree with those pages about what counts as a sale.
- Compares **"today so far" against "yesterday, the same hours so far"** — not a full
  previous day, which would be a misleading partial-vs-complete comparison — for Orders,
  and (Super Admin only) Revenue and Profit.
- `changePercent` is `null` — displayed as "No comparison available" — whenever
  yesterday's figure was 0. **Never a fabricated or divide-by-zero percentage.**
- Consolidated the pre-existing "Gross Profit"/"Net Profit" split into a single "Profit"
  card, correcting a leftover inconsistency with the already-confirmed business rule
  ("PROFIT means PROFIT... do not unnecessarily split into Gross/Net") that had never
  actually been applied to this specific page.
- Removed the "Inventory Value" placeholder card rather than either wiring up an
  unrequested new metric under time pressure or leaving another silent "—" — a deliberate
  scope decision, not an oversight; flagged here for visibility.
- **Second real bug caught and fixed while building this**: `getLowStockCount()` (the
  Dashboard's "Low Stock" card, and used elsewhere) still used the OLD flat
  `currentStock <= lowStockThreshold` check — NOT the tiered `getStockStatus()` percentage
  rule already applied to the Product list, Inventory list, and Inventory report earlier
  in Phase 8. This meant the Dashboard's count could have silently disagreed with what the
  Inventory page itself calls "low stock." Fixed to use the same `getStockStatus()`
  function everywhere.

### 9. Admin language — re-swept

No new violations found in any file touched this pass.

### 10. Delete / development mode — reconfirmed untouched

No changes. Staff/Category/Product delete with self-protection and dependent-record
safety, all built in the prior pass, untouched by this one.

### 11. Customer flow architecture — reconfirmed untouched, extended safely

`findOrCreateCustomerByEmail` remains the sole customer-creation path (see item 7) — this
pass only added fields it writes, never a new way to create one.

### 12. Dark Mode — explicitly NOT attempted, confirmed filed under Phase 9

No dark-mode work was done this pass, per instruction. Settings still shows it as "Not
available yet" with no implication of imminent availability.

### Files Added

- `lib/actions/dashboard.ts`

### Files Modified

`lib/customers/identity.ts`, `app/api/webhooks/paystack/route.ts`, `lib/actions/customers.ts`,
`components/admin/customers/customer-table.tsx`, `components/admin/customers/customer-detail.tsx`,
`components/admin/reports/export-csv-button.tsx`, `lib/actions/inventory.ts`,
`app/admin/dashboard/page.tsx`, `components/admin/inventory/inventory-table.tsx`,
`components/admin/categories/category-table.tsx`.

### Files Deleted

None.

### Database Changes

None.

### PRESERVED Phase 1–7 + Phase 8 Reconciliation List (exact ordering as specified)

1. `Order.paymentReference` needs a real unique constraint for stronger webhook idempotency.
2. Offline-sale price/discount needs proper database fields (currently encoded in the
   `reason` string — see the dedicated correction entry above in this file).
3. Proper independent Color × Size structure (currently a concatenated string per
   combination — sparse combinations now work correctly at the UI/application level via
   an exclusion-tracking set, but the underlying storage is still one string per variant).
4. Order lifecycle review (the 4-value MVP status mapped onto a richer 9-value schema
   enum — see `lib/utils/order-status.ts`'s own top comment).
5. Paystack idempotency/concurrency (application-level check only, no DB constraint — same
   as item 1).
6. Payment failure/retry handling (`CustomerEvent` used as a stand-in; no dedicated
   `PaymentAttempt` model).
7. Customer identity resolution (email-anchored only; phone/name never used as a match
   key — a known, documented MVP limitation).
8. Best Seller persistence/enforcement (uses `Product.featuredFlags`, a String array — this
   works and is now consistently enforced everywhere, but a dedicated allocation model
   would be more explicit at reconciliation).
9. Inventory audit semantics (Restock/Offline Sale/Correction/Damage/Return all share one
   `reason` string convention for classification — a real `StockChangeType.OFFLINE_SALE`
   enum value, or a dedicated model, is the cleaner long-term shape).
10. Dashboard comparison calculations — now implemented (see item 8 above) using existing
    data; no schema needed after all, removed as a blocking item, kept here as "review" in
    case a different comparison basis is wanted later (e.g. same weekday last week instead
    of yesterday).
11. Settings architecture — Change Password is real and working; Notifications has no
    schema field to persist a preference (a small `User` preferences column would resolve
    this); Store Branding/Payments remain intentionally unbuilt.
12. Category variant configuration architecture — **the main new item this pass**: no
    field exists on `Category` to store a variant configuration (type + available values)
    that a future admin-created category could define once. The existing GENERIC
    per-product variant picker (Color/Size/Material/Other) already covers the underlying
    need without this, but doesn't let a Super Admin pre-configure it centrally. Recommend
    a `Category.variantConfig` (Json, or a proper join structure) at final reconciliation.

### Testing Checklist

1. `npm run build`.
2. Add a category — confirm the button shows "Adding..." briefly, confirm the category
   appears immediately in a fresh visit to the New Product page, and confirm the
   explanatory note about per-product variant choice is visible.
3. Complete a test order with a shipping address in its metadata — confirm the resulting
   Customer record shows phone AND location (not just email/name as before).
4. Go to Customers, apply a search or lifecycle filter, click Export CSV — confirm a
   "Preparing..." state appears briefly, then "Downloaded," and confirm the file only
   contains the filtered customers with all 8 requested columns.
5. Open Inventory — confirm a variant-holding product now shows "Show N variants" collapsed
   by default; click it, confirm the full variant table/list appears with a "Variants (N)"
   label; confirm a non-variant product is unaffected.
6. Open the Dashboard — confirm Orders Today/Revenue/Profit show a real number and an
   up/down arrow with a percentage, or "No comparison available" if yesterday had nothing.
   Confirm no percentage is ever shown when yesterday's value was 0.
7. Confirm the Dashboard's "Low Stock" count matches what the Inventory page itself shows
   as needing attention (Low/Very Low/Out of Stock combined).
8. Confirm "Gross Profit"/"Net Profit" no longer appear anywhere on the Dashboard — only
   "Profit."

### Suggested Git Commit Messages

```
feat(categories): loading state on Add Category; honest explainer for future-category variant behavior

feat(inventory): expandable variant lists on inventory cards

fix(inventory): getLowStockCount now uses the same tiered stock-status logic as every other inventory view

feat(customers): capture and display delivery location from order shipping data (schema field existed, was unused)

feat(customers): Export CSV button on the Customers page respecting active filters

fix(reports): ExportCsvButton now properly awaits async export functions

feat(dashboard): real day-over-day comparison for Orders/Revenue/Profit, consolidate Gross/Net Profit into one Profit metric
```

### Documentation Updated

This file only.

---

## Phase 8 — UI/UX Correction Pass (real bugs, traced and root-caused)

Per instruction: nothing below was assumed fixed because the component/action existed —
each item was traced through the actual UI interaction to its server action to its data
layer, and the real root cause is documented, not just the symptom. No schema changes.

### 1. Category Management — "Add Category" not working

Traced the full pipeline (form → `createCategory` action → validation → database write →
revalidation → Product Form's category query). The create logic itself was structurally
correct. Found and fixed two real gaps that plausibly explain the reported failure:

- **Revalidation scope gap (the likely main cause)**: `createCategory`/`updateCategory`/
  `setCategoryActive` called `revalidatePath("/admin/products")` — but the Product Form's
  category picker is fetched server-side on the SEPARATE routes `/admin/products/new` and
  `/admin/products/[id]/edit`, neither of which that call reaches. A newly created category
  could fail to appear in the Product Form until an unrelated cache expiry — looking exactly
  like "creating a category doesn't work," even though the category WAS created. Fixed by
  switching to `revalidatePath("/admin/products", "layout")`, which invalidates the entire
  `/admin/products/*` subtree.
- **No Enter-key handler**: the category name input had no `onKeyDown` and wasn't inside a
  `<form>` — pressing Enter (the natural first thing to try) did nothing at all, silently.
  Added an Enter handler that triggers the same create action as the button.
- Hardened `createCategory` itself: trims and validates the name isn't empty before
  attempting a slug, and catches a genuine database-level collision (two admins creating the
  same name in the same instant) with a clear message instead of a raw error.

The three core categories (Bags/Shoes/Slippers) remain seeded automatically and were never
the issue — this was specifically about admin-created future categories.

### 2. Product Form — Variant checkbox not clickable (real bug, found and fixed)

Root cause: a `useEffect` in `variants-section.tsx` was meant to auto-uncheck "Has
variants" when the admin removes the LAST remaining variant row. It checked only
`fields.length === 0` — which is ALSO true the instant the checkbox is first checked
(before any variant row has been added yet). The effect fired immediately after every
single check, snapping the checkbox back to unchecked on the next render — making it
appear completely unresponsive. Fixed by tracking the PREVIOUS fields count in a ref and
only auto-reverting on a genuine transition from having variants to having none — never on
the initial "just turned it on" state.

### 3. Variant progressive behaviour (Bags / Shoes+Slippers) — verified, one real gap fixed

The category-aware configurator (Bag = colour only; Shoes/Slippers = colour and/or size
with generated combinations) was already structurally correct once the checkbox bug above
was fixed. Found one more real, concrete bug while verifying "the admin should control
which combinations exist": `generateCombinations()` always rebuilt the FULL colour×size
cross-product every time it ran — a combination the admin deliberately removed (e.g.
"Yellow / 8" doesn't exist) would silently reappear the next time they clicked "Generate
Combinations" again, e.g. after adding one more colour. Fixed with an `excludedCombos`
tracking set: a removed combination stays removed across regenerations, with a small
"Removed — won't be included..." list the admin can use to explicitly add one back if they
change their mind.

### 4. Product Preview — traced and fixed (was silently doing nothing on validation failure)

The Preview button calls React Hook Form's `trigger()` to validate the whole form before
switching views — correct in principle. The actual bug: when a variant row had an empty
name (e.g. the admin clicked "+ Add Color" but hadn't typed a name yet), validation
correctly failed, but **no error message was ever shown for that failure** — array-item
field errors weren't checked anywhere, only whole-array-level errors. Clicking "Preview"
would silently do nothing, with zero visible feedback about why. Fixed by:
- Showing a red border + inline message on the specific variant row with the problem.
- Adding a summary message when any variant has an error.
- Adding a general banner ("Please fix the highlighted fields below before continuing.")
  whenever `trigger()` fails for ANY reason, so the admin is never left wondering why
  nothing happened.

Preview itself is not static/faked data — it reads live `getValues()` from the form (see
§4 in the request: "Do not fake the preview using static data"), and Edit returns to the
exact same form state (nothing is cleared) since the form component never unmounts —
`step` is just a local view toggle around the same `useForm` instance.

### 5. Image upload architecture — rebuilt to match the confirmed flow exactly

The previous implementation gated all image selection behind the product already existing,
requiring the admin to leave the creation flow and return to a separate edit page — exactly
what was explicitly ruled out. Rebuilt as instructed:

**Select images locally → Preview → Create Product → product created → images uploaded to
Cloudinary automatically, in the same continuous action, no second manual step.**

- `components/admin/products/staged-image-picker.tsx` (new) — for a NEW product only, lets
  the admin select/drag-drop photos, held as local blob previews (nothing uploaded yet, no
  premature Cloudinary calls).
- `product-form.tsx`'s `onSubmit` — after `createProduct()` returns the new product's id,
  each staged photo is immediately sent through the EXISTING `uploadProductImage` media
  action (Cloudinary architecture untouched, just called automatically instead of manually)
  before the admin is taken to the new product's edit page. The button shows live progress
  ("Adding photos (2/4)...") during this — the "short delay of a few seconds" is visible and
  expected, not hidden.
- **Failure handling**: if a specific photo fails to upload, product creation itself still
  succeeds (never lost over a photo problem) — the admin lands on the edit page with a
  clear, specific warning naming how many photos didn't make it, where the real, already-
  working `ImageUploader` is sitting right there to retry.
- `product-preview.tsx` now shows the ACTUAL staged photos (via their local blob URLs), not
  a placeholder note.
- Editing an existing product is unchanged — `ImageUploader` still uploads immediately on
  selection, since the product (and thus a valid Cloudinary association target) already
  exists there.

**Known remaining gap, not attempted this pass**: per-VARIANT images (e.g. a Bag's Yellow
option needing its own photo) are still gated behind the product existing — only the
GENERAL product gallery was rebuilt to the staged/auto-upload flow this pass, since variant
rows don't have real database IDs to associate an image with until after creation, which
would need tracking staged variant images by array position and re-linking them to real
variant IDs in creation order — a meaningfully larger change than the general gallery fix.
Flagged honestly here rather than silently left as a surprise; a reasonable candidate for a
fast follow-up.

### 6. Reports — Export CSV button now visibly actionable, and verified to respect filters

Replaced the identical ghost-button markup duplicated across all four report tabs with one
shared `components/admin/reports/export-csv-button.tsx`: a clearly-styled gold-tinted
button with a proper `cursor-pointer`, hover/active states, a disabled state, and — new —
actual success ("Downloaded") / failure ("Couldn't export — try again") feedback, since the
previous version had no try/catch at all and gave no confirmation that anything happened.
Verified (by inspection, not assumption) that every export already builds its CSV from the
same filtered `lines`/`rows` state driven by the report's active Date/Category/Source
filters — exporting was already scoped to what's currently displayed, never the whole
table; only the button's visibility/feedback needed fixing.

### 7. Best Sellers — the real bug: eligible products were being filtered out entirely

The picker component itself was structurally fine. The actual bug was in
`getBestSellerAllocation()`: it only queried products with `status: "ACTIVE"`. Every new
product defaults to `DRAFT` status in the product form (unchanged unless the admin
explicitly flips it) — meaning any admin who created test products without separately
activating them would see EMPTY sections in Best Sellers, exactly matching "I don't see a
usable way to choose an existing product." Fixed to show all non-archived products (Draft
included), with a small "Draft — not visible to customers yet" note so it's clear a
Best-Seller-marked Draft won't actually show anywhere until published. This also surfaced a
second, more serious consistency bug: `assertBestSellerCapAllows()` (the actual server-side
cap enforcement) still counted ACTIVE-only toward the 4-product limit — meaning the picker
could display "2/2 selected" (counting Drafts) while the enforcement function would have
allowed MORE Drafts past the cap, since it wasn't counting them. Both now count the exact
same set of products (`status: { not: "ARCHIVED" }`), so the displayed count and the
enforced limit can never disagree. Added the confirmed business-language explainer at the
top of the page: "Choose the products you want to appear in the Best Sellers section on the
homepage."

### 8. Settings — Change Password (both roles), honest Notifications/Dark Mode

- `changeOwnPassword()` (new, in `lib/actions/staff.ts`) — genuine self-service password
  change for BOTH roles, always acting on the caller's own account, requiring the current
  password (bcrypt-verified) before allowing a change. Kept as a separate function from the
  existing `resetStaffPassword` (a Super Admin overriding someone else's password without
  knowing it) rather than one function with a conditional, so neither path can accidentally
  skip a check the other relies on.
- Settings is no longer Super-Admin-only at the route level (`middleware.ts`'s
  `SUPER_ADMIN_ONLY_PREFIXES` and the sidebar's `superAdminOnly` flag both updated) — Support
  Admin can now reach the page and change their own password; the WhatsApp/Branding/Payments
  sections stay conditionally rendered for Super Admin only within the page itself.
- **Notifications**: described in the confirmed business language ("Get alerts when
  customers place orders, payments are received, or important order updates occur") but
  marked "Not available yet" — there is no schema field to actually persist a notification
  preference anywhere, and building a fake toggle that doesn't save anywhere would be
  exactly the "controls that do nothing" anti-pattern this correction pass explicitly warns
  against. Documented below as a Phase 8 reconciliation item (a small `User` preferences
  column) rather than either faked or silently skipped.
- **Dark Mode**: checked whether this is "already safe and supported by the current UI
  architecture" as instructed. Tailwind has `darkMode: "class"` configured, but a project-
  wide search found ZERO `dark:` variant classes anywhere across the ~40+ admin components —
  this is a config stub, not a working theme. Implementing real dark mode now would mean
  touching every component's colors, which is precisely the "unstable theme system"
  introduced under time pressure this instruction warns against avoiding. Documented for
  Phase 9, not attempted.

### 9. Admin language — continued

Re-swept every component touched this pass (and re-checked the Best Sellers page's own
copy, which still said "The frontend consumes this selection" — removed) for
backend/frontend/API/database/schema language reaching the visible UI. None found in
user-facing text as of this pass.

### 10. Testing discipline followed for this entire correction pass

Every item above was investigated by reading the ACTUAL current code — the real component,
the real action, the real validator — not assumed correct because it existed. Three genuine
root-caused bugs were found this way (the variant-checkbox effect, the missing per-item
variant error display, and the Best Sellers ACTIVE-only filter) that would not have been
caught by re-reading my own prior summary.

### 11. IMPORTANT — Damaged Stock re-confirmed absent

No file touched this pass reintroduces `damagedStock` into any UI or workflow. The
Inventory card still shows exactly: Total Stock, Available Stock, Low Stock Threshold,
Stock Status, variant breakdown, "Updated X ago," and Adjust Stock — unchanged from the
prior correction.

### 12. Files Added

- `components/admin/products/staged-image-picker.tsx`
- `components/admin/reports/export-csv-button.tsx`
- `components/admin/settings/change-password-form.tsx`

### 13. Files Modified

`lib/actions/categories.ts`, `components/admin/categories/category-table.tsx`,
`components/admin/products/variants-section.tsx`, `components/admin/products/product-form.tsx`,
`components/admin/products/product-preview.tsx`, `app/admin/products/new/page.tsx`,
`app/admin/products/[id]/edit/page.tsx`, `lib/actions/best-sellers.ts`,
`lib/best-sellers/enforce-cap.ts`, `components/admin/best-sellers/best-seller-picker.tsx`,
`app/admin/best-sellers/page.tsx`, `components/admin/reports/sales-report-view.tsx`,
`components/admin/reports/financial-report-view.tsx`,
`components/admin/reports/customers-report-view.tsx`,
`components/admin/reports/inventory-report-view.tsx`, `lib/validators/staff.ts`,
`lib/actions/staff.ts`, `app/admin/settings/page.tsx`, `middleware.ts`,
`components/admin/sidebar.tsx`.

### 14. Files Deleted

None.

### 15. Database Changes

None.

### 16. Preserved / Extended Phase 8 Reconciliation List

Every prior item carried forward unchanged, plus:

16. **Notification preferences have no schema field** — a real `User` column (boolean flags
    or a small JSON preferences object) would be needed before Notifications can be a real,
    saveable setting rather than the honest "Not available yet" placeholder shown now.
17. **Dark mode is configured but not implemented** — `darkMode: "class"` exists in
    `tailwind.config.ts`; zero components use `dark:` variants. A real implementation is a
    UI-wide styling pass, not a schema question, but sizeable enough to warrant its own
    planned phase rather than a rushed retrofit.
18. **Per-variant image staging before product creation** — deferred, see §5 above.

### 17. Testing Checklist

1. `npm run build`.
2. Create a category by pressing Enter (not clicking the button) — confirm it's created;
   immediately open the New Product page and confirm the new category appears in the
   picker without a manual refresh.
3. Create a new Shoe product, check "Has variants" — confirm the checkbox stays checked and
   the Colour/Size configurator appears (does not snap back).
4. Click "+ Add Color" without typing a name, then click Preview — confirm a clear red
   error appears on that exact row and a banner explains something needs fixing (not
   silence).
5. Generate Yellow/7, Yellow/8, Yellow/9 for a Shoe, remove Yellow/8, then add colour
   "Black" and click Generate Combinations again — confirm Yellow/8 does NOT reappear, and
   confirm it's listed under "Removed" with an "Add back" option.
6. Create a product with two photos selected locally — confirm Preview shows the real
   selected photos (not placeholder text), click Edit, confirm nothing was lost, click
   Create Product, confirm a brief "Adding photos (n/n)..." state appears, and confirm both
   photos are attached to the product afterward.
7. Go to Best Sellers immediately after creating a Draft (unpublished) product — confirm it
   NOW appears in its category section with a "Draft" note, and can be selected; confirm
   the 2/1/1/4 caps still can't be exceeded.
8. Click Export CSV on any report — confirm it now looks clearly clickable, shows a
   "Downloaded" confirmation briefly, and the file only contains the currently filtered
   rows.
9. As Support Admin, open Settings — confirm you can change your own password and do NOT
   see the WhatsApp/Branding/Payments sections; confirm Notifications/Dark Mode show as
   "Not available yet" for both roles.
10. As Super Admin, confirm all sections appear correctly.

### 18. Suggested Git Commit Messages

```
fix(categories): revalidate the full /admin/products subtree so new categories appear immediately in the product form

fix(categories): add Enter-key submission, validate/handle name collisions

fix(products): variant checkbox no longer reverts itself the instant it's checked

fix(products): sparse Color×Size combinations no longer resurrect a removed combination on regenerate

fix(products): surface per-variant validation errors so Preview never silently does nothing

feat(products): select photos before creation, auto-upload to Cloudinary immediately after product creation succeeds

feat(reports): shared, clearly-actionable Export CSV button with success/error feedback

fix(best-sellers): show Draft products in the picker and count them consistently in cap enforcement

feat(settings): self-service Change Password for both roles; honest Notifications/Dark Mode placeholders
```

### 19. Documentation Updated

This file only.

---

## Phase 8: Refinement — Build Fix, Product/Inventory UX, Deletion, Settings

No schema changes. Everything below was either a direct requirement from the Phase 8
refinement request or a correctness fix caught while implementing it.

### 0. BUILD ERROR — fixed

`lib/actions/best-sellers.ts:73` referenced `BEST_SELLER_TOTAL_MAX`, which had been dropped
from that file's import list during the Best Sellers bypass fix (the cap-check logic moved
to `lib/best-sellers/enforce-cap.ts`, but `getBestSellerAllocation()`'s own use of the
constant for the `totalMax` field returned to the UI was missed). Fixed by restoring it to
the import — **no duplicate constant created**; `lib/constants/best-sellers.ts` remains the
only place `BEST_SELLER_TOTAL_MAX` is defined. Verified with a project-wide grep that every
file importing from that module has matching imports/usages, and re-ran the `"use server"`
export-safety sweep (the same class of bug) across every server action file — clean.

**I could not run a real `npm run build` in this environment** (no network access, no
installed dependencies) — see the top-level summary for what I did verify instead, and
please run the real build first.

### 1. CONFIRMED RULES — verified untouched, not modified this phase

- Restock (`INCREASE`) vs Offline Sale vs Correction (`DECREASE`/`ADJUST`) — `INCREASE`
  never asks for classification; `DECREASE`/`ADJUST` still require the Offline Sale/
  Correction choice with price capture. Verified by direct inspection of
  `lib/validators/inventory.ts` and `stock-adjust-dialog.tsx` — nothing in this phase's
  diffs touches either file's business logic.
- Actual offline selling price + discount capture (from the prior discount clarification) —
  untouched.
- Online discount snapshotting into `OrderItem.unitPrice` — untouched.
- Paystack PENDING flow (payment confirmed → PENDING → stock deducted immediately → admin
  views → PROCESSING → Complete → COMPLETED) — untouched; nothing in this phase touches
  `lib/actions/orders.ts` or the webhook.
- Best Sellers 2 Bags + 1 Shoe + 1 Slipper / 4 total — untouched in this phase (was fixed
  in the prior session); this phase only fixed the build error referencing its constant.
- Customer data originating from checkout/orders — untouched; `findOrCreateCustomerByEmail`
  is still only ever called from the Paystack webhook, never from a manual "add customer"
  UI (none exists).

### 2. CORRECTION applied mid-phase: "Damaged Stock" removed from the new Inventory UI

While building the Inventory card's stock-breakdown grid, I initially included a "Damaged"
stat inferred from the reference screenshot's visual structure. This was flagged as NOT a
confirmed requirement and reverted before it shipped. The `Product`/`ProductVariant`
schema's `damagedStock` column and the pre-existing `DAMAGE` stock-adjustment type
(`lib/validators/inventory.ts`'s `STOCK_CHANGE_TYPES`, already selectable in the adjust
dialog since Phase 1/Batch 2) are completely unrelated and were NOT touched — only the two
`select` clauses in `lib/actions/inventory.ts`'s `listInventory()` that I'd added
specifically to feed the now-removed UI stat were trimmed back. The Inventory card's stock
breakdown now shows exactly: Total Stock, Available Stock (Total minus anything reserved
for a pending order), Low Stock Threshold (single-value products only), Stock Status,
variants and their quantities, Last Updated, and Adjust Stock — matching the confirmed list
exactly, nothing more.

### 3. Files Added

- `lib/utils/stock-status.ts` — `getStockStatus()`: In Stock / Low Stock / Very Low Stock /
  Out of Stock, combining the confirmed 70%/90% sold-through percentage rule with an
  absolute floor derived from each product's own `lowStockThreshold` — so a product with
  only 2 units total doesn't need to sell 1.8 of them before warning (the floor fires
  immediately for small quantities; the percentage rule dominates for larger ones).
- `lib/utils/relative-time.ts` — dependency-free "2h ago" formatter for the Inventory
  card's "Updated" line.
- `lib/config/customer-care.ts` — `getCustomerCareWhatsApp()`/`getCustomerCareWhatsAppLink()`,
  reading a single `CUSTOMER_CARE_WHATSAPP` env var. No checkout/storefront code exists in
  this admin repository to actually SEND the low/out-of-stock customer message yet (same
  scope boundary noted since Phase 2) — this gives that number a single real home, ready
  for whenever the storefront needs it, rather than it being hardcoded inline somewhere
  later.
- `app/admin/settings/page.tsx` — **the route didn't exist at all before this phase**
  (the sidebar linked to a 404). Now shows the real, config-driven WhatsApp number and
  honestly labels Store Branding/Notifications/Payments "Not available yet" rather than
  presenting non-functional controls.
- `lib/constants/categories.ts` — `CORE_CATEGORY_SLUGS` (Bags/Shoes/Slippers), the single
  source of truth for "which categories can never be permanently deleted."
- `components/admin/products/product-preview.tsx` — the Preview step (§5): image/gallery
  (or an honest "photos come after creation" note for a brand-new product, since images
  still only upload to Cloudinary after the product exists — architecture preserved as
  instructed), name, description, category, price with discount applied, variants and
  their stock. Edit / Create Product (or Save Changes) actions.

### 4. Files Modified

**Product form (§1, §2, §5)**
- `components/admin/products/product-form.tsx` — rebuilt: Category selection now comes
  first (drives the variant UI below it); Homepage Placement and Product Specifications
  sections **removed entirely** (not just hidden — no longer rendered, no longer part of
  the visible flow); the form now leads into the new Preview step instead of saving
  directly — `handleSubmit`/actual creation only fires from the Preview screen's
  confirmation button.
- `components/admin/products/featured-toggles.tsx`, `components/admin/products/spec-editor.tsx`
  — no longer imported by the product form (orphaned but left in place, not deleted, since
  neither schema data nor other code depends on their removal — flagged in the summary
  below as safe cleanup candidates rather than silently deleted).

**Stock status tiers (§10)**
- `lib/actions/products.ts` — `listProducts()`'s variant select gained `soldStock` (needed
  for the percentage half of the tiering calculation).
- `components/admin/products/product-table.tsx` — replaced the flat
  `currentStock <= lowStockThreshold` check with `getStockStatus()`; a product with several
  variants now shows the WORST status across all of them (never a false "In Stock" badge
  when even one variant is critically low).
- `lib/actions/inventory.ts` — `listInventory()` now selects `soldStock`/`reservedStock`,
  computes `stockStatus` per base/variant row server-side, and returns `totalStock` and
  `updatedAt` for the card header.
- `components/admin/inventory/inventory-table.tsx` — card header restructured (name, status
  badge, category, option count, total stock, "Updated X ago"); new stock-breakdown grid
  (see §2 above for what it does and doesn't show); per-variant badges upgraded to the
  tiered status.
- `lib/actions/reports.ts` — `getInventoryReport()` uses the same `getStockStatus()`, so the
  report and the live Inventory page can never disagree about what "low stock" means.
- `components/admin/reports/inventory-report-view.tsx` — displays the tiered status; CSV
  export column renamed from "Low Stock?" to "Stock Status".

**Deletion (§19)**
- `lib/actions/staff.ts` — added `deleteStaff()`: blocks self-delete, blocks deleting the
  only remaining Super Admin, catches a foreign-key rejection (activity/inventory history
  attached) and surfaces "revoke instead" rather than a raw error.
- `components/admin/staff/staff-table.tsx` — wired a Delete button (desktop + mobile) with
  a confirmation dialog.
- `lib/actions/categories.ts` — added `deleteCategory()`: blocks deleting any of the three
  core categories permanently (archive is still available for those), blocks deleting a
  category that still has products assigned.
- `components/admin/categories/category-table.tsx` — wired the Delete button (hidden for
  the three core categories), confirmation dialog.
- `components/admin/products/product-table.tsx` — a hard-delete action already existed
  (`deleteProduct`, blocks deletion of any product with order history) but had no UI
  trigger; added the Delete button next to Archive.

**Sparse Color × Size combinations (§4) — correctness fix**
- `components/admin/products/variants-section.tsx` — `generateCombinations()` previously
  always rebuilt the FULL colour×size cross-product every time it ran, which meant a
  combination the admin deliberately removed (e.g. "Yellow / 8" doesn't actually exist)
  would silently reappear the next time they clicked "Generate Combinations" — e.g. after
  adding one more colour. Added an `excludedCombos` tracking set: removing a combination now
  marks it as deliberately excluded, regeneration always respects that, and a small
  "Removed — won't be included..." chip list lets the admin explicitly restore one if they
  change their mind. This is the actual fix for "the system should NOT force every
  theoretical combination if some combinations do not exist" (§4) — the earlier
  implementation's own code comment claimed this already worked; it didn't, until now.

**Category filters, category-aware config (§7/§8)**
- No changes needed — `lib/constants/product-category-kind.ts` (Bags = colour-only,
  Shoes/Slippers = colour+size) and `CategoryFilterTabs` (Product/Inventory, defaulting to
  ALL) already matched the requirement from Phase 1/Batch 2. Confirmed by inspection, not
  reimplemented.

### 5. Files Deleted

None. `featured-toggles.tsx` and `spec-editor.tsx` are now unreferenced (see §4 above) but
left in place rather than deleted, since deleting files wasn't requested and there's no
harm in them sitting unused pending a decision on whether Homepage Placement gets a new,
non-Best-Sellers admin surface in a later phase.

### 6. Database Changes

None.

### 7. Environment Variable Changes

Added `CUSTOMER_CARE_WHATSAPP` to `.env.example` (optional — Settings page shows "Not set
up yet" if absent, never a fake/placeholder number).

### 8. Preserved / Extended Phase 8 Reconciliation List (§23)

Carrying forward every item from the original list, unchanged, plus:

13. **Category-level variant configuration (§6/§7)** — Bags/Shoes/Slippers' variant
    behavior is still a hardcoded slug map (`lib/constants/product-category-kind.ts`), not
    an admin-configurable setting stored on `Category` itself. Fine for the three core
    categories (their behavior is fixed by business rule, per §7), but a genuinely flexible
    future category with admin-defined variant behavior (§6's "Accessories: Color" example)
    would need a real `Category.variantConfig` (or similar) column — not built, since only
    three categories exist today and the master prompt itself calls this "safe to defer."
14. **Report export product/variant/customer filters have logic but no picker UI** —
    unchanged from the original Phase 4 note; still flagged, not addressed this phase (was
    not called out as a priority item in the Phase 8 refinement request).
15. **`damagedStock` / `DAMAGE` change type** — pre-existing since Phase 1/Batch 2, explicitly
    NOT part of this phase's Inventory UI (see §2 correction above). No action needed unless
    a future phase decides to build real damaged-stock reporting.

### 9. Explicitly Deferred (per the refinement request's own "Safe to Defer")

Dashboard yesterday-comparison indicators (§21) — the request itself says this doesn't need
implementing until schema reconciliation/testing unless already safe to add now; not
attempted this phase given the scope already covered.

### 10. What I could NOT verify

I have no network access or installed dependencies in this sandbox — **no real
`npm run build`, no `tsc`, no Prisma generate**. Every check in this phase (and every prior
one) was: brace/paren balance counts across every touched file, a project-wide grep for the
exact "use server" export-safety violation that caused the original build error, and manual
cross-referencing of every server action's returned shape against what the consuming
client component actually reads. This catches a real class of bugs (proven — it found the
original error) but is not a substitute for a real compiler. Please run the actual build
and report back before this is trusted further.

### 11. Testing Checklist (once `npm run build` passes)

1. Create a new product end-to-end: category first, fill details, add a Bag colour variant
   or a Shoe colour+size combination, remove one specific combination, add a new colour, and
   confirm the removed combination does NOT reappear. Click Preview, confirm the summary
   looks right, click Edit, confirm you're back in the form with nothing lost, click Create
   Product.
2. Confirm Homepage Placement and Product Specifications do not appear anywhere in the
   product form.
3. Create a product with only 2 units of stock — confirm it shows a Low/Very Low Stock
   warning immediately, not only after "70% sold" of a 2-unit pool becomes meaningless.
4. Open Inventory — confirm each card shows Total Stock, Available Stock, Low Stock
   Threshold (single-item products), Stock Status, "Updated X ago", and Adjust Stock; confirm
   NO "Damaged" stat appears anywhere.
5. Try to delete a Super Admin's own account, and the only remaining Super Admin's account —
   confirm both are blocked with a clear message.
6. Try to delete "Bags" — confirm it's blocked; archive/reactivate it instead and confirm
   that still works.
7. Try to delete a category that has at least one product assigned — confirm it's blocked
   with a message naming how many products.
8. Open Settings as Super Admin — confirm the WhatsApp number shows correctly if
   `CUSTOMER_CARE_WHATSAPP` is set, and shows the honest "not set up yet" message if it
   isn't; confirm the other three sections are visibly marked unavailable, not fake-clickable.
9. Confirm Restock (`+10`, no classification asked), Offline Sale (price required), and
   Correction (no price field) all still behave exactly as before this phase.
10. `npm run build`.

### 12. Suggested Git Commit Messages

```
fix(best-sellers): restore BEST_SELLER_TOTAL_MAX import, fixing the build error

feat(products): rebuild product form — category-first flow, remove Homepage Placement and Specifications, add Preview step

feat(inventory): tiered stock status (In Stock / Low / Very Low / Out of Stock) combining percentage-sold and an absolute floor

feat(inventory): restructure cards with stock breakdown, option count, and last-updated

fix(products): sparse Color×Size combinations — removed combinations no longer reappear on regenerate

feat(admin): permanent delete for Staff and Categories with dependency/self-protection safety rails

feat(settings): build the Settings page for the first time — real WhatsApp config, honest "not available yet" for the rest
```

### 13. Documentation Updated

This file only.

---

## Phase 7: Homepage Best Sellers

No schema changes — reuses `Product.featuredFlags` (already includes `"best_sellers"` as a
valid value, already consumed by the public API's `featured=best_sellers` filter). This
phase adds the CAPPED admin picker; the underlying flag mechanism already existed.

### 1. FINAL CONFIRMED RULE implemented exactly as specified

**2 Bags + 1 Shoe + 1 Slipper = 4 total maximum. Never 5.** Enforced in two places:
- **Visually**: `components/admin/best-sellers/best-seller-picker.tsx` shows a live
  "X/Y selected" count per category and a "Total X/4" header; the Select button is disabled
  (with a tooltip explaining why) the moment a category reaches its cap — a product already
  selected can always be deselected regardless of cap state.
- **In business logic**: `toggleBestSeller()` in `lib/actions/best-sellers.ts` re-checks the
  cap server-side before allowing an enable — counting live from the database, not trusting
  whatever the UI last rendered — so a stale page or a direct action call can't bypass the
  limit. A defensive total-count check (`BEST_SELLER_TOTAL_MAX = 4`) backs up the per-
  category caps in case they're ever changed independently and drift out of sync with the
  sum.

### 2. Relationship to the general `featuredFlags` toggle (Phase 1) — includes a self-caught bug fix

`"best_sellers"` was already one of several general `featuredFlags` values an admin could
toggle from the product form's Homepage Placement section (Phase 1). **While writing this
entry, I claimed that toggle already went through the same cap-enforcing code path — I
checked instead of leaving that unverified, and it was false.** `createProduct`/
`updateProduct` (`lib/actions/products.ts`) accepted `featuredFlags` containing
`"best_sellers"` with **zero cap enforcement** — the validator only checks that each flag is
one of the known enum values, not how many products already carry it. That was a real
bypass of the confirmed 4-max rule, caught and fixed within this same phase before being
presented as done:

- `lib/best-sellers/enforce-cap.ts` (new) — `assertBestSellerCapAllows()` and
  `getBestSellerCategorySlug()`, extracted so the cap check is ONE piece of logic shared by
  every code path that can set the flag, not reimplemented per call site.
- `lib/actions/best-sellers.ts`'s `toggleBestSeller()` — refactored to call the shared
  helper instead of its own inline version (behavior unchanged, just de-duplicated).
- `lib/actions/products.ts`'s `createProduct()` — now checks the cap whenever
  `featuredFlags` includes `"best_sellers"` (a new product can never have been a Best Seller
  already, so this always applies when the flag is present).
- `lib/actions/products.ts`'s `updateProduct()` — checks the cap only on a genuine
  transition (`!wasBestSeller && willBeBestSeller`), so re-saving an already-selected
  product with unrelated changes never trips over its own existing selection.
- `components/admin/products/featured-toggles.tsx` — the `"best_sellers"` checkbox is
  removed from the general grid entirely (UX, not the enforcement — the server-side check
  above is what actually matters). An admin who fills out an entire product form would
  otherwise only discover the cap was full at the very last step (save); now they're pointed
  to the dedicated `/admin/best-sellers` page, where the live count is visible before they
  commit to anything. If the product already IS a Best Seller (set via the dedicated page),
  a status note with a link replaces the checkbox — the flag itself is preserved on save via
  the same hidden-field pattern already used for SKU/Brand/Barcode (Phase 1), it's just not
  editable from this form anymore.

Both UIs write to the same underlying `featuredFlags` field and now share the exact same
enforcement function, so they can never drift out of sync with each other or with the cap.

### 3. Files Added

- `lib/constants/best-sellers.ts` — `BEST_SELLER_CAPS` (`{ bags: 2, shoes: 1, slippers: 1 }`,
  keyed by category slug — matching Phase 1's seeded categories, not hardcoded IDs),
  `BEST_SELLER_TOTAL_MAX` (4), `BEST_SELLER_FLAG` ("best_sellers").
- `lib/best-sellers/enforce-cap.ts` — the shared cap-enforcement logic (see §2 above).
- `lib/actions/best-sellers.ts` — `getBestSellerAllocation()` (three sections, one per
  capped category, each listing every ACTIVE product in it with current selection state)
  and `toggleBestSeller()`.
- `components/admin/best-sellers/best-seller-picker.tsx` — the picker UI described in §1.
- `app/admin/best-sellers/page.tsx`.

### 4. Files Modified

- `components/admin/sidebar.tsx` — added a "Best Sellers" nav item (Star icon) between
  Products and Inventory.
- `lib/actions/products.ts` — `createProduct()`/`updateProduct()` now enforce the cap (§2).
- `components/admin/products/featured-toggles.tsx` — `"best_sellers"` checkbox replaced
  with a status note + link to the dedicated page (§2).

### 5. Files Deleted

None.

### 6. Database Changes

None.

### 7. RBAC

Reuses `products:read`/`products:write` (both roles) rather than introducing a new
permission — Best Sellers is fundamentally a product-attribute decision, not a distinct
resource. Nothing here is financial/restricted under §36 (product name/image/price are
already visible to both roles elsewhere).

### 8. SCHEMA GAPS

None new. If a future need arises for the frontend to show WHY a product is a best seller,
an ordering/rank within its category, or a scheduled start/end date for the promotion,
those would need new `Product` columns or a dedicated `BestSeller` join model — not
required by anything in the master prompt's current scope, so not spec'd out further here.

### 9. Testing Checklist

1. `npm run build`.
2. Open Best Sellers — confirm three sections (Bags/Shoes/Slippers) each list only ACTIVE
   products from that category.
3. Select 2 Bags — confirm the 3rd Bag's Select button becomes disabled with an explanatory
   tooltip; confirm Shoes/Slippers are unaffected.
4. Select 1 Shoe and 1 Slipper — confirm the Total header reads "4/4" and every remaining
   unselected product across all three sections is now disabled (total cap reached), even
   in categories not yet at their individual cap.
5. Deselect one Bag — confirm the Bags section immediately allows a new selection again,
   and the Total drops to 3/4.
6. Confirm a product outside Bags/Shoes/Slippers never appears in any section (create one
   in an archived/legacy category if you have test data, or confirm via `toggleBestSeller`
   directly rejecting it with the "isn't in Bags, Shoes, or Slippers" error).
7. **With Best Sellers already at 4/4**, try to create a brand-new product and manually
   submit `featuredFlags: ["best_sellers"]` (or edit an existing non-best-seller product to
   add the flag) — confirm the save is REJECTED with the cap-exceeded error, proving the
   product form's own save path can't bypass the limit. Confirm the checkbox for
   "Best Sellers" no longer appears in the product form's Homepage Placement section at all.
8. Open the edit page for a product that IS currently a Best Seller — confirm a status note
   with a link to `/admin/best-sellers` appears in place of a checkbox, and confirm saving
   that product with unrelated changes does NOT trip the cap check (it already had the flag,
   so this is not a new addition).
9. Confirm the public product API's `featured=best_sellers` filter returns exactly the
   selected 4 (or fewer) products.

### 10. Suggested Git Commit Messages

```
feat(best-sellers): capped allocation picker (2 Bags + 1 Shoe + 1 Slipper, 4 total max)

fix(products): enforce Best Sellers cap in createProduct/updateProduct, not just the dedicated picker

feat(admin-ui): remove uncapped best_sellers checkbox from product form, link to dedicated page instead
```

### 11. Documentation Updated

This file only.

---

## CLARIFICATION: Online vs Offline discount handling (two distinct concepts, kept separate)

Applied before continuing to Phase 7, per explicit instruction. Inspected the existing
implementation first — found and fixed a real correctness bug in the Paystack webhook
(item 1 below), and added the missing offline-sale discount capture (item 2). No schema
changes.

### 1. ONLINE / PRODUCT DISCOUNT — bug fix

**Found**: `Product.discount` (a percentage, `Decimal(5,2)` — e.g. `6.25` for a ₦5,000
discount off an ₦80,000 item) was already exposed on the public product API (`discount`
field, both summary and detail DTOs) — that part was already correct. But the Paystack
webhook's `handleChargeSuccess` computed `OrderItem.unitPrice` directly from
`product.price`, **completely ignoring `discount`**. A discounted product would still be
charged and recorded at full listed price.

**Fixed**:
- `lib/pricing/effective-price.ts` (new) — `computeEffectivePrice(price, discountPercent)`,
  the single shared calculation used by both the webhook and the public API, so the
  storefront's displayed selling price and the price actually charged can never disagree.
- `app/api/webhooks/paystack/route.ts` — now computes each line's effective (discounted)
  price via that helper and writes it into `OrderItem.unitPrice` — an already-existing
  column, captured once at order creation. Since it's never recomputed afterward, "if the
  admin later changes the discount, old orders don't change" is satisfied automatically —
  the same pattern already used for the historical-price snapshot, just now correctly
  discount-aware.
- `lib/api/public-product-select.ts` — both DTOs gained a precomputed `discountedPrice`
  field (via the same shared helper) alongside the existing `price`/`discount` fields, so
  the storefront doesn't have to duplicate the percentage math itself — `price` stays the
  "crossed-out" listed price, `discountedPrice` is what to show as the selling price.

### 2. OFFLINE / WALK-IN DISCOUNT — new capture

**Confirmed as NOT previously implemented**: the prior Offline Sale correction (see the
CORRECTION entry above) captured only the actual amount paid. It did not capture the
listed price at that same moment, so no discount figure could be derived or displayed.

**Added**:
- The system now automatically captures the product's **current price at the exact moment
  the offline sale is recorded** — server-side, in `adjustStock`/`adjustVariantStock`
  (`lib/actions/inventory.ts`), never client-supplied. The admin still only ever enters the
  actual amount paid (unchanged from the prior correction) — the "original price" side is
  system-derived, matching "The Admin enters the actual amount paid; the system calculates
  the discount."
- `lib/inventory/reason-log.ts` — the `reason` string encoding extended from
  `[OFFLINE_SALE:<actual>]` to `[OFFLINE_SALE:<actual>:<original>]`. `parseAdjustmentReason`
  now also returns `originalPrice` and a derived `discountAmount` (`originalPrice -
  unitSellingPrice`) — computed on read, never stored as its own field, so there is exactly
  one source of truth (the two captured prices) and no risk of the derived amount drifting
  from them.
- `lib/reports/sales.ts` — `SalesLine` gained `originalPrice`/`discountAmount` (both always
  `null` for ONLINE lines — see the "two distinct concepts" note below). Revenue itself is
  UNCHANGED from the prior correction (`unitSellingPrice × quantity` — still never estimated,
  still `null`/"Unknown" when a log has no captured price).
- `components/admin/reports/sales-report-view.tsx` — offline rows with a positive discount
  now show a small "was ₦80,000, −₦1,000" line under the revenue figure, both desktop and
  mobile; the CSV export gained `Original Price`/`Discount` columns.

### 3. Why these are two separate concepts, not one

- **Online discount** is a *product-level setting* (`Product.discount`, a percentage) that
  applies to every online sale of that product until changed. It is baked into
  `OrderItem.unitPrice` at order time via `computeEffectivePrice()`.
- **Offline discount** is an *ad-hoc, per-transaction negotiation* — there is no
  product-level "offline discount %" setting, and the amount varies sale to sale (a
  customer haggling in person). It only ever exists as the difference between the listed
  price and what that one customer actually paid, computed per sale, never stored as a
  standing product attribute.

Conflating these — e.g. trying to apply `Product.discount` to offline sales, or storing an
offline "discount percentage" back onto the product — would be exactly the mixing this
instruction warned against. They now share no code path except the same
`InventoryLog`/`VariantInventoryLog.reason` string convention used for classification, and
even that encodes them completely differently (online needs no price at all in the reason
string; only offline does).

### 4. Files Modified

- `lib/pricing/effective-price.ts` (new)
- `app/api/webhooks/paystack/route.ts`
- `lib/api/public-product-select.ts`
- `lib/inventory/reason-log.ts`
- `lib/actions/inventory.ts`
- `lib/reports/sales.ts`
- `components/admin/reports/sales-report-view.tsx`

### 5. Files Deleted

None.

### 6. Database Changes

None — as instructed.

### 7. SCHEMA GAPS — REQUIRED at Phase 8 reconciliation (new entries)

| Area | Current MVP approach | Required schema change |
|---|---|---|
| **Offline sale original price + discount** | Encoded as a second suffix on the `reason` column (`[OFFLINE_SALE:actual:original]`), discount derived on read | Add `unitSellingPrice` AND `originalPrice` (or `listedPriceAtSale`) Decimal columns to `InventoryLog`/`VariantInventoryLog` — carried over and extended from the prior correction's recommendation, now covering both prices, not just one |
| **Online per-order discount snapshot** | `OrderItem.unitPrice` already stores the discount-applied price correctly (fixed this batch) — but the discount PERCENTAGE and pre-discount listed price at that moment are not separately snapshotted, only derivable from `unitPrice` vs whatever `Product.price`/`Product.discount` happen to be *now* | If a future report needs "exactly how much discount was given on this specific online order" independent of the product's current settings, add `listedUnitPrice`/`discountPercentApplied` columns to `OrderItem`. Not required for correctness today (unitPrice alone is sufficient and accurate for revenue/history) — only for a more detailed discount-attribution report later. |

### 8. Testing Checklist

1. `npm run build`.
2. Set a product's discount to a nonzero percentage. Confirm the public product API
   (`/api/v1/public/products` and the detail route) returns `price`, `discount`, and a
   correctly-computed `discountedPrice`.
3. Complete a test Paystack order for that discounted product — confirm the resulting
   `OrderItem.unitPrice` reflects the DISCOUNTED price, not the full listed price; confirm
   `Order.subtotal` is computed from the discounted price too.
4. Change the product's discount (or remove it) AFTER that order exists — confirm the
   existing order's `unitPrice`/subtotal are completely unaffected (re-open the order in
   Phase 2's Order detail page and confirm the figures didn't move).
5. Record an Offline Sale at a price below the product's current listed price — confirm the
   Sales report shows "was ₦X, −₦Y" under the revenue figure, with Y equal to (listed −
   actual).
6. Change the product's price after recording that offline sale — confirm the previously
   recorded sale's "was ₦X" figure does NOT change (it's frozen at the price captured when
   the sale was recorded, not re-derived from the current price).
7. Confirm a Correction adjustment still shows no price/discount fields anywhere and is
   still excluded from revenue.
8. Confirm CSV export from the Sales report includes the new Original Price/Discount
   columns with correct values.

### 9. Suggested Git Commit Messages

```
fix(orders): apply product discount when computing Paystack order line prices (was ignoring discount entirely)

feat(public-api): expose precomputed discountedPrice using the same calculation as order pricing

feat(inventory): capture listed price alongside actual selling price for offline sales, derive discount on read

feat(reports): surface offline-sale discount (original vs actual price) in the Sales report
```

### 10. Documentation Updated

This file only.

---

## Phase 6: Communication

No schema changes — uses the existing `Campaign`/`CustomerEvent` models as-is. Corrects a
gap in the original architecture assessment: the `resend` package and `RESEND_API_KEY` env
var already existed, but no actual client wrapper did (unlike `lib/cloudinary.ts`) — built
one this phase, following the same pattern.

### 1. Files Added

- `lib/resend.ts` — `sendEmail({ to, subject, html })`, mirroring `lib/cloudinary.ts`'s
  shape. Throws with the Resend error message on failure so callers can catch per-recipient
  failures individually (see below).
- `lib/validators/communication.ts` — `sendCustomerEmailSchema`.
- `lib/actions/communications.ts` — `searchCustomersLite()` (lightweight recipient search,
  distinct from Phase 3's paginated `listCustomers`), `listFailedPaymentCustomers()` (§42:
  "Contact customers associated with failed payments" — reuses the `CustomerEvent`
  "PAYMENT_FAILED" records the Phase 2 webhook already writes, last 30 days),
  `sendCustomerEmail()` (one Resend call per recipient — not a single bulk send — so
  `{{firstName}}` personalization is genuinely per-recipient and one bad address can't fail
  the whole batch; failures are collected and returned, not thrown), `listSentCampaigns()`.
- `components/admin/communications/email-composer.tsx` — recipient search-and-select
  (debounced), a one-click "Add customers with failed payments" shortcut, subject/message
  fields with a `{{firstName}}` hint, Send Now, and a Recent Sends sidebar.
- `app/admin/communications/page.tsx` — the sidebar nav entry already existed (added ahead
  of schedule during Phase 2), so no sidebar change was needed this phase.

### 2. Files Modified

- `.env.example` — added `RESEND_FROM_ADDRESS` (optional, documented default) alongside
  the already-present `RESEND_API_KEY`.

### 3. Files Deleted

None.

### 4. Database Changes

None. `Campaign.recipientRule` (Json) stores `{ type: "explicit", customerIds: [...] }` —
the schema already anticipated a rule-based recipient system (broadcast segments, etc.);
this MVP only ever uses the explicit-list form, per §42's "not a full marketing automation
platform."

### 5. RBAC

`communications:read`/`communications:write` — both already present on both roles in
`lib/permissions.ts`. Nothing here is financial or otherwise restricted under §36.

### 6. SCOPE NOTE (§42 compliance)

Deliberately NOT built, per "Do not build a full marketing automation platform": scheduled
sends (`Campaign.status` has a `SCHEDULED` value in the schema, unused here), audience
segmentation/rules beyond an explicit recipient list, open/click tracking, a rich HTML
editor (`toSimpleHtml()` does a minimal plain-text-to-paragraphs conversion only),
templates/saved drafts.

### 7. SCHEMA GAPS

None new. `Campaign.stats` (Json) stores `{ recipientCount, successCount, failureCount }`
per send — sufficient for the Recent Sends list; a dedicated per-recipient delivery-status
model would be the Phase 8 upgrade if per-recipient tracking (not just aggregate counts)
becomes necessary.

### 8. Testing Checklist

1. `npm run build`.
2. Search for a customer by name and by email — confirm both match; select one, confirm
   they appear as a removable chip.
3. Click "Add customers with failed payments" (requires at least one `PAYMENT_FAILED`
   `CustomerEvent` in the last 30 days, e.g. from a Phase 2 `charge.failed` test webhook) —
   confirm they're added without duplicating an already-selected recipient.
4. Send an email with `{{firstName}}` in both subject and message to 2+ recipients — confirm
   each received email has their own first name substituted (check via Resend's dashboard
   or a test inbox).
5. Confirm the send result banner reports success/failure counts correctly; confirm a
   `CustomerEvent` "EMAIL_SENT" was recorded for each successful recipient (visible on their
   Phase 3 Customer detail page's Communication History section).
6. Confirm Recent Sends updates immediately after sending.
7. Temporarily use an invalid `RESEND_API_KEY` — confirm the send fails gracefully with a
   clear per-recipient failure rather than crashing the whole request.

### 9. Suggested Git Commit Messages

```
feat(communications): Resend client wrapper (package/env var existed, client did not)

feat(communications): customer search, failed-payment shortcut, personalized email composer

feat(communications): per-recipient send with {{firstName}} personalization and send history
```

### 10. Documentation Updated

This file only.

---

## CORRECTION to Phase 4/5: Offline sale revenue must never be estimated from current price

**Caught before implementation was accepted — this replaces the original Phase 4 Sales/
Financial revenue logic and the Phase 5 Analytics revenue logic that depended on it.** The
original approach estimated offline-sale revenue using the product's CURRENT price
(`revenueIsEstimated: true` / `isEstimated: true` flags in the original Phase 4/5 entries
below). This was wrong: a stock adjustment happening today does not mean the item sold at
today's price, and using the current price would silently fabricate historical financial
data the moment `Product.price` ever changes. This correction removes that approximation
entirely — no code path in the project now falls back to current price for a historical
sale figure.

### 1. The corrected architecture

- **ONLINE SALE** — Order + OrderItem. Historical unit selling price = `OrderItem.unitPrice`,
  captured once at order creation. Unchanged by this correction (it was already correct).
- **OFFLINE SALE** — an inventory adjustment classified `OFFLINE_SALE`. Historical unit
  selling price is now **captured at the moment the admin records the sale** — a new
  required "price this item actually sold for" field in the stock-adjust dialog, admin-
  entered, never inferred. Quantity, sale date, and actor (`performedById`) were already
  captured; customer remains optional/not applicable (offline sales have no customer
  record).
- **CORRECTION** — inventory adjustment only. No sale, no price, no revenue, no profit.
  Unchanged — a correction was never treated as a sale and still isn't.

### 2. How the price is captured without a schema migration

Per master-prompt schema discipline (no Prisma changes during Phases 1–7), the actual
selling price is encoded into the SAME free-text `reason` column already used for the
`OFFLINE_SALE`/`CORRECTION` classification prefix — extending the existing string
convention rather than adding a column:

```
[OFFLINE_SALE:1500.00] Sold in-store     <- price is what it ACTUALLY sold for
[CORRECTION] Recount after stocktake      <- no price — a correction is not a sale
```

This is a deliberate, documented MVP stand-in — see SCHEMA GAPS below for the real column
this should become at Phase 8.

### 3. Files Modified

- `lib/validators/inventory.ts` — added `unitSellingPrice` to both `adjustStockSchema` and
  `adjustVariantStockSchema`, with two new `.refine()` rules: OFFLINE_SALE is rejected
  without a price; CORRECTION is rejected WITH one (a correction has no sale price by
  definition — this isn't just unused, it's actively disallowed, so a slip of the UI can't
  attach a price to a non-sale).
- `lib/inventory/reason-log.ts` — `formatAdjustmentReason()` now encodes the price into the
  reason string; `parseAdjustmentReason()` now returns `unitSellingPrice: number | null`
  alongside `type`/`note`. Rewrote the file's top comment to state the correctness rule
  explicitly: this price is captured once, at record time, and Reports/Analytics must never
  substitute the product's current price when it's missing.
- `lib/actions/inventory.ts` — `adjustStock`/`adjustVariantStock` now pass
  `parsed.unitSellingPrice` through to `formatAdjustmentReason` and into the
  `ActivityLog` metadata for auditability.
- `components/admin/inventory/stock-adjust-dialog.tsx` — new "Price this item actually sold
  for (₦ per unit)" input, shown only when Offline Sale is selected, required before Apply;
  automatically cleared if the admin switches to Correction (so a stray price can never ride
  along on a non-sale adjustment); client-side validation blocks submission without it,
  matching the server-side `.refine()`.
- `lib/reports/sales.ts` — **rewritten**. `SalesLine.unitPrice`/`revenue` are now
  `number | null` (previously always `number`, backed by the current-price estimate).
  Added `revenueKnown: boolean` (replacing the old `revenueIsEstimated` flag, which meant
  something different and worse). An offline sale's `unitPrice`/`revenue` are `null` only
  when the underlying log has no captured price (i.e. it predates this correction) — NEVER
  filled in from `Product.price`. The module's top comment now documents the full ONLINE/
  OFFLINE/CORRECTION architecture end to end, per the confirmed design. Added
  `unknownRevenueCount` to the return value so every caller can surface the gap honestly.
- `lib/actions/reports.ts` — `getSalesReport`'s `totalRevenue` now sums only
  `revenueKnown` lines (never fabricated), with `unknownRevenueCount` surfaced in the
  summary. `getFinancialReport` excludes any unknown-revenue line from revenue/cost/profit
  aggregation entirely (its cost is excluded alongside its unknown revenue, rather than
  lopsidedly counting cost without revenue) — the line still appears in the row list, marked
  as such, so the admin can see the sale happened without it silently skewing totals.
- `lib/actions/analytics.ts` — same correction applied to `getAnalyticsOverview`: revenue,
  AOV, the trend chart, and the financial summary all sum `revenueKnown` lines only. Units
  sold and Best Sellers still count every sale (units are always known regardless of
  price) — only revenue/profit figures are affected.
- `components/admin/reports/sales-report-view.tsx`,
  `components/admin/reports/financial-report-view.tsx`,
  `components/admin/analytics/analytics-dashboard.tsx` — display "Unknown"/"No recorded
  price — excluded from totals" for any line without a captured price, instead of a number;
  each view now shows an amber notice whenever `unknownRevenueCount > 0`, naming exactly how
  many sales are affected and confirming they're excluded rather than estimated.
- `.env.example` — unrelated small addition alongside this batch: `RESEND_FROM_ADDRESS`
  (see Phase 6, in progress).

### 4. Files Deleted

None.

### 5. Database Changes

None — by design, per the schema-discipline instruction for this correction.

### 6. SCHEMA GAPS — REQUIRED at Phase 8 reconciliation (new/updated entry)

| Area | Current MVP approach | Required schema change |
|---|---|---|
| **Offline sale selling price** | Encoded as a suffix on the free-text `reason` column (`[OFFLINE_SALE:1500.00]`), parsed via regex in `lib/inventory/reason-log.ts` | Add a proper `unitSellingPrice` (Decimal) column to both `InventoryLog` and `VariantInventoryLog` — or, more robustly, a dedicated `OfflineSale` model referencing the log entry — so the price is a real, indexed, type-safe field instead of a parsed string. `lib/reports/sales.ts` should be updated to read that column directly once it exists, replacing the `parseAdjustmentReason` call for price extraction. |
| **StockChangeType classification** | Same string-prefix convention for OFFLINE_SALE vs CORRECTION vs ONLINE_SALE, unchanged by this correction | Still recommended: `StockChangeType.OFFLINE_SALE` as a real enum value (carried over from the original Phase 1/Batch 2 gap) |
| **Legacy unpriced offline sales** | Any `OFFLINE_SALE` log written before this correction has no price and permanently shows as "Unknown" in Reports/Analytics | Not fixable retroactively without fabricating data — Phase 8 discussion should include whether the business wants to manually backfill known historical prices for specific past sales (a deliberate, human-reviewed data-entry task, never an automated guess) |

### 7. Testing Checklist

1. `npm run build`.
2. Record an offline sale (Decrease, Offline Sale, price required) — confirm Apply is
   blocked with no price entered, confirm it succeeds once entered, confirm the resulting
   `InventoryLog`/`VariantInventoryLog.reason` contains the `[OFFLINE_SALE:X.XX]` prefix.
3. Record a Correction — confirm no price field appears at all.
4. Open the Sales report, filter to Offline — confirm the newly recorded sale shows its
   real entered price, not the product's current listed price (change the product's price
   afterward and re-check the report figure is unaffected).
5. If any pre-correction offline sale logs exist in your test database, confirm they show
   "Unknown" in the Sales/Financial reports and are excluded from every total, with the
   amber notice correctly counting them.
6. Confirm Analytics' revenue/profit/AOV/trend chart match the Sales/Financial report
   totals for the same filters (all three now share the same `revenueKnown`-only logic).
7. Confirm Units Sold and Best Sellers in Analytics still count unpriced offline sales by
   quantity (only revenue is excluded, not the sale's existence).

### 8. Suggested Git Commit Messages

```
fix(inventory): capture actual historical selling price at time of offline sale, never infer from current price

fix(reports,analytics): revenue/profit sums exclude any sale with no captured historical price
```

### 9. Documentation Updated

This file only.

---

## Phase 5: Analytics

Builds directly on Phase 4's `lib/reports/sales.ts` — Analytics and Reports read sales
through the exact same `getUnifiedSalesLines()` function, so the two modules can never
disagree about what counts as a sale, an online line, or an offline line. No schema
changes.

### 1. CONFIRMED RULES preserved, untouched by this phase

Same as Phase 4 — Analytics is read-only against Orders/Inventory/Customers. PENDING→
PROCESSING→COMPLETED, PENDING-stage deduction, Offline Sale vs Correction, Bags/Shoes/
Slippers, Color×Size variants, and the still-pending 4-slot Best Sellers allocation are
all untouched.

### 2. Files Added

- `lib/utils/date-presets.ts` — `DATE_PRESETS` (Today/7 days/30 days/3 months/12 months/
  Custom, per §34) and `resolveDatePreset()`.
- `lib/validators/analytics.ts` — filter schema (preset + custom range + category + sale
  source).
- `lib/actions/analytics.ts` — `getAnalyticsOverview()`. Computes every metric from §34:
  revenue/profit/profit margin (Super Admin only — see RBAC below), orders, units sold,
  average order value, new/returning customers, best sellers (top 5 by units in range),
  inventory low-stock count (a current snapshot, not date-ranged — stock levels aren't a
  historical concept the way sales are), online/offline sales split, category performance,
  and a daily revenue trend series for the chart.
- `components/admin/analytics/analytics-dashboard.tsx` — date-preset pills + category tabs
  + online/offline filter, KPI cards, a `recharts` line chart for the revenue trend (already
  a project dependency — no new package added), Best Sellers list, Category Performance
  list.
- `app/admin/analytics/page.tsx`.

### 3. Files Modified

None outside the Phase 4 bug fix already documented.

### 4. Files Deleted

None.

### 5. Database Changes

None.

### 6. RBAC

`analytics:read` (both roles) gates the whole page/action. `analytics:read:financials`
(Super Admin only) gates a `financials` sub-object (`revenue`/`cost`/`profit`/
`profitMargin`) that's `null` for Support Admin — the dashboard simply doesn't render those
three KPI cards when `financials` is null, rather than rendering them with hidden/zeroed
values. Every other metric (orders, units, AOV, customer counts, best sellers, low stock,
online/offline counts, category performance) is available to both roles, matching §36's
actual restricted list (only Cost/Profit/Margin/Revenue are named).

### 7. SCHEMA GAPS / design notes carried over

- Same offline-sale price-estimation caveat as Phase 4's Financial report — Analytics'
  `financials.cost`/`profit` figures inherit the same current-costPrice approximation for
  any offline sales in range.
- **New vs Returning classification window**: a customer who bought within the selected
  date range is classified New/Returning using their LIFETIME completed-order count as of
  now (same rule as Phase 3), not their status as of the end of that date range. A customer
  who was "New" during last month's range but has since placed a second order will show as
  "Returning" if you re-run last month's report today. This is a deliberate simplification
  (computing historical-point-in-time lifecycle would need order-by-order replay) — flagged
  here rather than silently assumed correct.
- **Category performance double-counting**: a line contributes revenue/units to EVERY
  category its product carries. Phase 1's `CategorySelect` only lets the admin choose one
  category going forward, so this only matters for legacy/multi-category data if any exists.

### 8. Testing Checklist

1. `npm run build`.
2. Load Analytics with the default 30-day preset — confirm every KPI card renders with
   plausible numbers matching what Phase 4's Sales/Customers/Inventory reports show for the
   same window.
3. Switch through each date preset (Today/7/30/3M/12M) and Custom — confirm the trend chart
   and KPIs update accordingly.
4. Filter by category and by Online/Offline — confirm Best Sellers and Category Performance
   narrow correctly.
5. As Support Admin: confirm Revenue/Profit/Profit Margin cards are entirely absent (not
   shown as blank/zero); confirm every other card is present and populated.
6. As Super Admin: confirm all three financial cards appear with figures consistent with
   Phase 4's Financial report for the same filters.
7. Confirm Low Stock Products count matches Phase 4's Inventory report's low-stock count
   for the same category filter (it should — same underlying query logic).

### 9. Suggested Git Commit Messages

```
feat(analytics): unified overview endpoint reusing Phase 4's sales data layer

feat(analytics): KPI dashboard with date presets, revenue trend chart, best sellers, category performance
```

### 10. Documentation Updated

This file only.

---

## Phase 4: Reports

Builds on Phases 1–3. No schema changes. Also fixes a latent bug from Phase 1/Batch 2 —
see item 0 below, found while wiring this phase's Sales report.

### 0. BUG FIX (pre-existing, not new to this phase)

`lib/actions/inventory.ts` is a `"use server"` file. Next.js requires every top-level
export from such a file to be an `async function` (every export becomes an RPC-callable
Server Action) — it had a synchronous `parseAdjustmentReason()` exported alongside the
real actions, which would have failed the Next.js build the moment it actually compiled.
Extracted `formatAdjustmentReason()`/`parseAdjustmentReason()` into a new plain module,
`lib/inventory/reason-log.ts` (no `"use server"`), imported by both
`lib/actions/inventory.ts` and this phase's `lib/reports/sales.ts`. Also found and fixed
the same category of bug freshly introduced in Phase 2: `lib/actions/orders.ts` was
re-exporting the const `ADMIN_ORDER_STATUSES` — also disallowed. `order-table.tsx` now
imports it directly from `lib/utils/order-status.ts` instead. Swept every `"use server"`
file in the project afterward to confirm no other instance of this exists.

### 1. CONFIRMED RULES preserved, untouched by this phase

- PENDING→PROCESSING→COMPLETED lifecycle, PENDING-stage inventory deduction, and the
  "no Start Processing action" rule (Phase 2) — Reports only *reads* Order/inventory data,
  never writes to it.
- Offline Sale vs Correction classification (Phase 1/Batch 2) — the Sales report is the
  first consumer of `parseAdjustmentReason()` outside of the adjustment dialog itself.
- Bags/Shoes/Slippers categories, Color×Size variants, and the (not-yet-built) 4-slot Best
  Sellers allocation — none touched here.
- The Paystack webhook's `metadata.cart`/`metadata.shippingAddress` assumption — untouched,
  still documented only in `app/api/webhooks/paystack/route.ts` and Phase 2's CHANGES.md
  entry.

### 2. Design decision: "Offline Sales" is not a separate report

Per §33, Reports should include Sales, Customers, Inventory, Offline Sales, and Financial.
Offline Sales is implemented as the Sales report filtered to `saleSource: "OFFLINE"`
rather than a fifth page — because Offline Sales is not a different *dataset*, it's a
different *source* within the same sales concept (§13 explicitly asks for an Online/Offline
filter on Reports generally, not a standalone page). This is documented prominently at the
top of `lib/reports/sales.ts` and in the Reports page's own subtitle, so it isn't a silent
scope decision.

### 3. Files Added

- `lib/inventory/reason-log.ts` — see BUG FIX above.
- `lib/reports/sales.ts` — `getUnifiedSalesLines()`, the single place online (Order/
  OrderItem) and offline (InventoryLog/VariantInventoryLog classified OFFLINE_SALE) sales
  are normalized into one common `SalesLine` shape and merged. Phase 5 (Analytics) will
  reuse this same function rather than re-deriving sales data a second way.
- `lib/utils/csv.ts` — dependency-free CSV serializer (`toCsv`).
- `lib/utils/download-csv.ts` — client-side Blob-download trigger; no server round-trip
  needed since every report action already returns its full filtered dataset.
- `lib/validators/report.ts` — shared filter schema (date range, category, product,
  variant, customer, sale source) and `REPORT_ROW_CAP` (2,000 — see RISKS).
- `lib/actions/reports.ts` — `getSalesReport()`, `getCustomersReport()`,
  `getInventoryReport()`, `getFinancialReport()` (Super Admin only, gated by
  `reports:read:financials`).
- `components/admin/reports/report-filter-bar.tsx`, `sales-report-view.tsx`,
  `customers-report-view.tsx`, `inventory-report-view.tsx`, `financial-report-view.tsx`,
  `report-tabs.tsx`.
- `app/admin/reports/page.tsx` — tabs: Sales, Customers, Inventory, and Financial
  (rendered only when `reports:read:financials` is true — Support Admin never sees the tab
  at all, not just a disabled one).

### 4. Files Modified

- `lib/actions/inventory.ts` — see BUG FIX.
- `lib/actions/orders.ts`, `components/admin/orders/order-table.tsx` — see BUG FIX.

### 5. Files Deleted

None.

### 6. Database Changes

None.

### 7. SCHEMA GAPS carried over / clarified this phase

| Area | Gap | Note |
|---|---|---|
| Offline sale revenue/cost | No price is captured at the moment of an offline stock adjustment | Every offline sales figure in Reports (and the future Financial report) is an ESTIMATE using the product's **current** price/costPrice, flagged per-row (`revenueIsEstimated`/`isEstimated`) rather than presented as exact. Same underlying gap as Phase 2's order-profit snapshot issue — Phase 8 could address both with one "snapshot price at transaction time" pattern. |
| `Order.profit` snapshot (Phase 2 gap) | Unchanged | The Financial report's online-sale profit figures inherit this same current-costPrice approximation. |

### 8. POTENTIAL RISKS reviewed for this batch

- **Row cap, not pagination**: every report action returns its full filtered result set
  (up to 2,000 rows) rather than paginating server-side — deliberate, since CSV export
  needs the complete set and the merged online+offline sales dataset doesn't paginate
  cleanly across two different underlying tables. A `truncated: true` flag and an on-screen
  notice tell the admin to narrow their date range if they hit the cap. Fine at MVP/boutique
  scale; revisit if order volume grows substantially.
- **No dedicated Product/Variant/Customer filter UI**: the filter *logic* fully supports
  `productId`/`variantId`/`customerId` (see `lib/validators/report.ts`,
  `lib/reports/sales.ts`) but this batch only wires up Date/Category/Source pickers in the
  UI — drilling into one specific product or customer's sales still works today from that
  product's or customer's own detail page. Documented as a UI gap, not a missing capability,
  so it's easy to add a picker later without touching the data layer.
- **Financial report double-gated**: verified both the page-level tab visibility (hidden
  entirely for Support Admin, not just disabled) AND the server action itself
  (`getFinancialReport` throws FORBIDDEN independent of what the UI shows) — so a Support
  Admin manually calling the action would still be rejected, consistent with the project's
  own stated RBAC principle that UI visibility is a convenience, not the security boundary.

### 9. Testing Checklist

1. `npm run build` — confirm the BUG FIX above actually resolves a build failure (this is
   the first time in the project's history these files would have been compiled for a
   production build with the synchronous exports in place).
2. Sales report: place an online order and record an offline sale (via Inventory adjust),
   confirm both appear with correct Source badges; filter to Offline only, confirm only the
   offline row remains; export CSV and confirm the file opens correctly with matching data.
3. Filter Sales by category — confirm only Bags/Shoes/Slippers-tagged lines remain per
   selection.
4. Customers report: confirm lifecycle/totals match what Phase 3's Customer detail page
   shows for the same customers.
5. Inventory report: confirm variant products produce one row per variant, non-variant
   products produce one row.
6. As Support Admin: confirm the Financial tab is entirely absent from the tab bar; confirm
   directly invoking `getFinancialReport` (e.g. via browser devtools calling the action) is
   rejected.
7. As Super Admin: confirm the Financial tab shows revenue/cost/profit/margin and its own
   CSV export.
8. Confirm every report defaults to unfiltered ("All") on first load, per §33's "Reports can
   be ALL or filtered."

### 10. Suggested Git Commit Messages

```
fix(inventory,orders): extract sync helpers out of "use server" files (Next.js build requirement)

feat(reports): unified online+offline sales data layer (lib/reports/sales.ts)

feat(reports): Sales, Customers, Inventory, and Financial report tabs with CSV export

feat(reports): Offline Sales as a Sales-report filter rather than a separate page
```

### 11. Documentation Updated

This file only.

---

## Phase 3: Customers

Builds on Phase 2 (Orders) — a Customer's order history, lifecycle, and spend are all
derived from the Order rows Phase 2 creates. No schema changes.

### 1. Files Added

- `lib/validators/customer.ts` — `CUSTOMER_LIFECYCLES` (`NEW`/`RETURNING`) and the list-filter
  schema (search by name/email/phone, lifecycle, pagination).
- `lib/actions/customers.ts` — `listCustomers()`, `getCustomer()`, `updateCustomerNotes()`.
  Lifecycle (`deriveLifecycle`) is computed fresh on every read from each customer's COMPLETED
  order count (2+ = Returning, per master prompt §32) — never hand-maintained, and deliberately
  NOT read from `Customer.lifetimeValue` (see SCHEMA GAPS).
- `components/admin/customers/customer-table.tsx` — list with search + lifecycle filter, desktop
  table + mobile cards (same split pattern as every other list in this project).
- `components/admin/customers/customer-detail.tsx` — profile header (order count/total spent/
  last order), full order history (links into Order detail), Failed Payment Attempts (only
  rendered if any exist — surfaces the recovery data captured by Phase 2's webhook), a merged
  Communication History section (Enquiries + Complaints, sorted together), and a Super/Support-
  gated internal notes editor.
- `app/admin/customers/page.tsx`, `app/admin/customers/[id]/page.tsx`.

### 2. Files Modified

- `components/ui/badge.tsx` — added `NEW`/`RETURNING` tones for the lifecycle badge.

### 3. Files Deleted

None.

### 4. Database Changes

None.

### 5. RBAC

Uses the existing `customers:read`/`customers:write` permissions verbatim — both already
present on both roles in `lib/permissions.ts` (Support Admin can view and edit customer
records/notes; there's nothing customer-related on the Super-Admin-only restricted list per
§36, which only names Cost/Profit/Margin/Revenue). `totalSpent` and each order's `subtotal` are
deliberately NOT run through `stripFinancialFields()` — same reasoning as Phase 2 Orders: what a
customer paid is operational information needed to serve them, not the `profit`/`costPrice`/
aggregate `revenue` metrics §36 actually restricts.

### 6. SCHEMA GAPS carried over / added this phase

| Area | Existing capability | Gap | Recommended change (Phase 8) |
|---|---|---|---|
| `Customer.lifetimeValue` | Column exists, defaults to 0 | Never written by any code in this MVP — `totalSpent` is computed at read time from `Order.subtotal` instead | Either wire it as a maintained cache (update on every order status change) or drop the column in favor of always-computed |
| Identity resolution | Match by email (unique) | Phone/name are captured but never used as a match key (§14) — two different emails for the same real person still produce two Customer rows | A deliberate future fuzzy-match feature, not a schema gap exactly — noting it here since it's a direct consequence of the email-only design |
| PaymentAttempt model | None (see Phase 2) | Failed payments live on `CustomerEvent` with `label: "PAYMENT_FAILED"` — readable, but not a first-class queryable model | Same recommendation as Phase 2: a dedicated `PaymentAttempt` model |

### 7. Testing Checklist

1. Open Customers — confirm the list only ever shows customers created via a real order (Phase
   2's webhook is the only place `findOrCreateCustomerByEmail` is called from in this MVP).
2. Place two Paystack test orders for the same email, complete both (Complete Order in Phase 2's
   Order detail) — confirm the customer's lifecycle flips from "New Customer" to "Returning
   Customer" and `totalSpent` reflects both orders.
3. Cancel one of a returning customer's completed orders — confirm lifecycle correctly drops back
   to "New Customer" (cancelled orders don't count) and `totalSpent` excludes it.
4. Trigger a `charge.failed` test webhook for a known customer email — confirm "Failed Payment
   Attempts" appears on their detail page.
5. As Support Admin, confirm Customers is visible and notes are editable; confirm `totalSpent`
   is visible (not stripped).
6. Save internal notes, refresh, confirm they persist.
7. `npm run build`.

### 8. Suggested Git Commit Messages

```
feat(customers): identity resolution, list + detail pages, derived lifecycle and spend

feat(customers): internal notes editor, failed-payment and communication history surfacing
```

---

## Phase 2: Orders

Builds on Phase 1 (Product & Inventory) — order line items reference real Products/
ProductVariants and deduct their stock through the exact same `Inventory`/`ProductVariant`
stock fields and `InventoryLog`/`VariantInventoryLog` audit trail Phase 1/Batch 2 already
established. No schema changes; several deliberate MVP mappings onto the existing schema
are documented below rather than migrated now, per master-prompt schema discipline.

### 1. CONFIRMED BUSINESS RULES preserved from your corrections

- **PENDING = payment confirmed + stock already deducted.** Inventory deduction happens
  in the same transaction as Order creation, at PENDING — not at PROCESSING. This is the
  corrected rule and is exactly what `handleChargeSuccess()` implements.
- **Viewing an order is what moves it PENDING → PROCESSING** — no separate "Start
  Processing" action exists anywhere in the code (see `getOrder()` and
  `lib/utils/order-status.ts`'s `assertValidOrderTransition`, which doesn't even list
  PENDING→PROCESSING as an admin-initiated transition).
- **Idempotent deduction, guarding duplicate Paystack webhook delivery** — `handleChargeSuccess`
  checks for an existing Order on the same `paymentReference` before creating anything; see
  SCHEMA GAPS below for the one honest caveat on how strong this guard currently is.
- **Offline Sale vs Correction** (Phase 1/Batch 2) is untouched by this phase — Orders and
  Inventory adjustments remain two separate systems, exactly as corrected: "The admin will
  NOT manually create an Order from the Admin site for a physical/store walk-in sale."
  Reports/Analytics (Phases 4/5) will be what brings online (Order-based) and offline
  (Inventory-adjustment-based) sales together side by side.

### 2. Files Added

**Shared infrastructure**
- `lib/customers/identity.ts` — `findOrCreateCustomerByEmail()` (email-anchored identity
  resolution, per §31/§14) and `recordCustomerEvent()`. Deliberately not a Server Action —
  it's called both by admin actions (which enforce their own auth) and by the unauthenticated
  Paystack webhook.
- `lib/utils/order-status.ts` — the `AdminOrderStatus` 4-value set
  (PENDING/PROCESSING/COMPLETED/CANCELLED) and its mapping onto the existing, richer
  `OrderStatus` schema enum. See SCHEMA GAPS — this is the single place that mapping lives.
- `lib/orders/stock.ts` — `checkStockAvailability()` (pre-payment guard, exported but not
  yet wired to anything — see RISKS) and `deductStockForOrder()` (the actual, once-only
  deduction called from the webhook).
- `app/api/webhooks/paystack/route.ts` — HMAC-SHA512 signature verification
  (`x-paystack-signature` against `PAYSTACK_SECRET_KEY`, timing-safe compare), handles
  `charge.success` (idempotent order creation + stock deduction + customer resolution) and
  `charge.failed` (customer resolution + `CustomerEvent` "PAYMENT_FAILED" record for
  recovery). See the ASSUMED PAYLOAD CONTRACT comment at the top of the file — this is a
  necessary, clearly-flagged assumption (see RISKS).
- `lib/validators/order.ts` — order filters and note schemas.
- `lib/actions/orders.ts` — `listOrders()`, `getOrder()` (with the auto PENDING→PROCESSING
  transition), `completeOrder()`, `cancelOrder()` (restocks every item), `addOrderNote()`.
- `components/admin/orders/order-table.tsx`, `components/admin/orders/order-detail.tsx`,
  `app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`.

### 3. Files Modified

- `lib/activity-log.ts` — `logActivity()` now accepts `systemSource` as an alternative to
  `userId` (a discriminated union — exactly one of the two, never both/neither), matching
  the schema comment on `ActivityLog.systemSource` ("e.g. paystack_webhook") that was
  already there waiting for this.
- `lib/actions/inventory.ts` — `parseAdjustmentReason()`'s regex broadened to also recognize
  the `[ONLINE_SALE]` prefix that `deductStockForOrder()` writes, so Reports/Analytics can
  read online and offline sale classifications through the one function.
- `lib/utils/slug.ts` — added `generateUniqueValueLike()`, a generic version of
  `generateUniqueSlug`/`generateUniqueSku` for any other unique string field (used here for
  `Order.orderNumber`).
- `lib/utils/serialize.ts` — added `serializeOrder()` (Decimal → number for `subtotal`,
  `profit`, and each item's `unitPrice`; run AFTER `stripFinancialFields()` so a stripped
  `profit` stays absent rather than serializing to a misleading `0`).
- `components/ui/badge.tsx` — added PENDING/PROCESSING/COMPLETED/CANCELLED tones.

### 4. Files Deleted

None.

### 5. Database Changes

None.

### 6. Environment Variable Changes

**New required variable**: `PAYSTACK_SECRET_KEY` — used by the webhook route to verify
Paystack's signature. Not present in `.env.example` before this batch; please add it to
your deployment environment (and to `.env.example` if you keep secrets' *names*, not
values, documented there).

### 7. SCHEMA GAPS (documented, not migrated — per master prompt §17)

| Area | Existing capability | Gap | Recommended change (Phase 8) |
|---|---|---|---|
| **Idempotency guard strength** | Application-level check (`findFirst` on `paymentReference` before create) | `Order.paymentReference` has **no** `@@unique` constraint — under true concurrent duplicate delivery (two webhook calls landing within the same race window), the check-then-create is not airtight | Add `@@unique([paymentReference])` to `Order`. This is the single highest-priority Phase 8 item from this batch — flagging it clearly rather than quietly relying on the weaker guard |
| Order status vocabulary | Rich 9-value `OrderStatus` enum | No `COMPLETED` value exists; this MVP maps admin-facing COMPLETED onto `DELIVERED` (closest existing semantic match) — see `lib/utils/order-status.ts`'s top comment for the full mapping and rationale | Either collapse the enum to the real 4 values, or formally rename `DELIVERED`→`COMPLETED` and remove the now-unused PAID/PACKED/SHIPPED/RETURNED/REFUNDED values |
| Failed payment records | None (`CustomerEvent` used as a stand-in, label `"PAYMENT_FAILED"`) | Not a first-class queryable model — fine for showing a customer's own history, weak for e.g. "show me all failed payments in the last 7 days across all customers" | Dedicated `PaymentAttempt` model, as flagged in the original assessment |
| Order profit snapshot | `Order.profit` computed at creation from **current** `Product.costPrice` | If `costPrice` changes after the sale, the stored `profit` no longer reflects what was actually true at sale time — there's no per-item cost snapshot | Add a `unitCostPrice` (or similar) column to `OrderItem`, snapshotted at creation |

### 8. POTENTIAL RISKS reviewed for this batch

- **Assumed Paystack metadata contract**: this repository has no checkout-initiation
  endpoint (that lives in the separate storefront project) — the webhook has to assume
  *some* shape for `metadata.cart`/`metadata.shippingAddress` in order to reconstruct what
  was purchased. That assumption is written out explicitly at the top of
  `app/api/webhooks/paystack/route.ts`. **If the actual storefront integration uses a
  different metadata shape, `parseCartFromMetadata()` in that file is the only place that
  needs to change.** Flagging this prominently rather than letting it be a silent
  assumption — please confirm this matches (or update) whatever the storefront actually
  sends.
- **Pre-payment stock check not wired anywhere**: `checkStockAvailability()` exists and
  implements the exact customer-facing messages from §29/§15 ("Only N units are currently
  available...", "This product is currently unavailable...") but nothing calls it yet,
  because the checkout-initiation step it belongs to isn't part of this codebase. Without
  it, there's currently no way to prevent a customer from starting a Paystack payment for
  more stock than exists — `deductStockForOrder()` will still refuse to oversell (it floors
  at 0 and records a shortfall note on the order, per below) but only AFTER the customer
  has already paid, which is a worse outcome than catching it before payment.
- **Stock shortfall after payment**: if stock somehow drops below what was ordered between
  "customer started checkout" and "payment confirmed" (e.g. two near-simultaneous
  purchases of the last unit), `deductStockForOrder` never goes negative — it deducts what's
  available and the webhook writes an `OrderNote` flagging the shortfall for manual admin
  review. The order still stands (the customer already paid); reconciling manually is safer
  than either overselling silently or leaving a paid order in limbo.
- **Cancel-and-restock correctness**: `cancelOrder()` restocks every line item back onto
  `Inventory`/`ProductVariant` inside the same transaction as the status change, logged as a
  `RETURN`-type entry (same audit trail every other stock mutation uses) — verified this
  can't leave stock updated without the order status changing, or vice versa.

### 9. Testing Checklist

**Manual tests to perform on your machine (no live Paystack account or database available
in this sandbox — these need real testing on your end):**
1. Point a Paystack test-mode webhook (or a signed `curl` request built with your test
   `PAYSTACK_SECRET_KEY`) at `/api/webhooks/paystack` with a `charge.success` payload whose
   `metadata.cart` references a real product/variant. Confirm: an Order is created at
   PENDING, stock is deducted by exactly the ordered quantity, a Customer is created (or
   matched by email if one already exists).
2. Re-send the exact same payload (same `reference`) — confirm NO second Order is created
   and stock is NOT deducted twice.
3. Send a `charge.failed` payload for a known customer email — confirm no Order is created
   and the customer's detail page shows the failed attempt (Phase 3).
4. Open the new PENDING order in the admin UI — confirm it flips to PROCESSING on that
   view, and does NOT flip again on a second view.
5. Click "Complete Order" — confirm status becomes COMPLETED (stored as DELIVERED) and a
   timeline entry is added; confirm the button disappears once completed.
6. Cancel a PROCESSING order — confirm every line item's stock is restored and a
   confirmation dialog was required first.
7. As Support Admin, open an order — confirm `profit` is not shown but `subtotal`/item
   totals are.
8. Filter Orders by category (Bags/Shoes/Slippers) and status — confirm results match; confirm
   default view is unfiltered ("All").
9. Send a webhook payload with an invalid/missing signature — confirm a 401 with no detail
   leaked about why.
10. `npm run build`.

**Known limitations (see SCHEMA GAPS/RISKS above for full detail):**
- Idempotency relies on an application-level check, not a database unique constraint —
  correct for realistic Paystack retry patterns, not airtight under true concurrency.
- No pre-payment stock-availability check is wired up (the endpoint it belongs to isn't
  part of this repo).
- The Paystack webhook metadata contract is this batch's own reasonable assumption, not
  confirmed against a real storefront integration.

### 10. Suggested Git Commit Messages

```
feat(activity-log): support systemSource-attributed entries (e.g. paystack_webhook)

feat(orders): Paystack webhook — idempotent order creation with PENDING-stage inventory deduction

feat(orders): admin-facing 4-status lifecycle mapped onto existing OrderStatus enum

feat(orders): list + detail pages, view-triggers-processing, complete/cancel-with-restock actions

feat(inventory): recognize ONLINE_SALE reason prefix alongside OFFLINE_SALE/CORRECTION
```

### 11. Documentation Updated

This file only.

### 12. Upgrade Instructions

1. Apply all file changes listed above.
2. Add `PAYSTACK_SECRET_KEY` to your environment.
3. Register `https://<your-domain>/api/webhooks/paystack` as a webhook URL in your Paystack
   dashboard.
4. Confirm with whoever owns the storefront checkout integration that `metadata.cart`/
   `metadata.shippingAddress` matches the ASSUMED PAYLOAD CONTRACT in
   `app/api/webhooks/paystack/route.ts` — update `parseCartFromMetadata()` if not.
5. `npm run build`.
6. Run through the manual testing checklist above.
7. Commit, push.

---

## Phase B: Product & Inventory UI

Builds directly on Phase A (category correction) — the variant configurator below
detects Bag vs Shoe/Slipper by reading the category IDs that Phase A's `CategorySelect`
now writes. No schema changes in this batch either; see the SCHEMA GAPS section for
what's deferred to Phase 8 and why.

### 1. Files Added

- `components/admin/shared/category-filter-tabs.tsx` — the "All | Bags | Shoes | Slippers"
  tabs, shared by both Product and Inventory pages so the two never drift apart. Renders
  whatever active top-level categories exist rather than hardcoding the three names.
- `lib/constants/product-category-kind.ts` — maps a product's selected category (by slug)
  to which variant-configurator mode the form should show (`BAG` / `SHOE_OR_SLIPPER` /
  `GENERIC`). Explicitly a UI-only mapping — there's no `productType` column; Category
  stays the single source of truth.

### 2. Files Modified

**Product form**
- `lib/validators/product.ts` — `sku` and `shortDesc` are now optional on input (server
  auto-fills both when blank; the database columns are unchanged and still required/
  unique). `variantSchema.sku` is likewise optional now — the admin never types a variant
  SKU either. `categoryIds` still validates as a non-empty array (schema unchanged) even
  though the UI now only ever lets one be selected.
- `lib/actions/products.ts` — added `autoProductSku()`, `autoVariantSku()`, and
  `autoShortDesc()`. `createProduct`/`updateProduct` now fall back to these whenever the
  admin didn't supply a value; variant create (both in `createProduct` and the
  new-variant branch of `updateProduct`'s diff loop) does the same. Existing, already-
  saved variants are never re-SKU'd on edit — a variant's SKU is set once at creation and
  left alone afterward, since it may already be referenced by a past `OrderItem`.
- `components/admin/products/category-select.tsx` — rewritten from a multi-checkbox list
  to single-select pills. Still writes `categoryIds` as a one-element array (Category is
  many-to-many at the schema level); the UI just never offers more than one.
- `components/admin/products/product-form.tsx` — removed the Brand, SKU, Barcode inputs
  and the Tags chip-input entirely; removed the Short Description input; relabeled "Full
  Description" to "Description". Reordered Core Details to Name → Slug → Description →
  Category, moved Variants to immediately follow Pricing (ahead of the now-optional
  Specifications section), matching the flow in the master prompt. Cost Price/Brand/SKU/
  Barcode are still submitted on save via React Hook Form's hidden-field behavior (a field
  present in `defaultValues` but never `register()`'d still round-trips on submit) — so
  editing an existing product doesn't silently blank out its brand or barcode.
- `components/admin/products/variants-section.tsx` — rewritten with three modes selected
  by `getProductCategoryKind()`:
  - **BAG** — color-only, variant type locked to "Colour" (no picker shown).
  - **SHOE_OR_SLIPPER** — new Color/Size checkboxes with chip-inputs for each axis and a
    "Generate Combinations" button that computes the cartesian product ("Yellow / 7",
    "Yellow / 15", "Black / 7", …) into the variant rows below, each with its own stock
    field. Regenerating preserves existing rows (matched by value string, keeping their
    id/sku/stock/image) and only adds/drops what actually changed — it does not wipe
    stock counts for combinations that still exist. On an existing product, the
    color/size chip lists are reconstructed by parsing already-saved " / "-joined values;
    flagged in the component as a best-effort heuristic, not a guarantee, given the
    underlying schema only stores the combined string.
  - **GENERIC** — the original free-text variant-type picker (Colour/Size/Material/
    Other), preserved as a fallback for any product outside the three launch categories
    (legacy data, or a future 4th category) so nothing already in the database becomes
    unrepresentable.
  - The per-row SKU input is gone from all three modes — SKU is never typed by hand
    anywhere now.

**Category & Inventory filtering**
- `components/admin/products/product-table.tsx` — category `<select>` replaced with
  `CategoryFilterTabs`. Desktop rows and mobile cards now also show a Best Seller badge
  (derived from `featuredFlags.includes("best_sellers")`) and an explicit "Has
  variants"/"No variants" indicator, matching the card-content spec. Mobile cards gained
  an explicit "View" action alongside Edit/Duplicate/Archive.
- `lib/actions/inventory.ts` — `listInventory()` gained a `categoryId` filter param (same
  many-to-many `some` pattern as `listProducts`) and now selects+returns each product's
  categories.
- `components/admin/inventory/inventory-table.tsx` — added `CategoryFilterTabs`; each
  card's header now shows the product's category name(s) instead of just its SKU. The
  per-variant listing inside a card, which was a raw `<table>` at every breakpoint, is now
  a real desktop table (`hidden md:table`) alongside a separate stacked mobile list
  (`md:hidden`) — the previous version would have forced horizontal scrolling on a phone
  for any product with several variants, which the master prompt explicitly rules out.
- `app/admin/inventory/page.tsx` — now fetches categories via `listCategoriesFlat()` and
  passes them to `InventoryTable`.

**Offline Sale vs Correction**
- `lib/validators/inventory.ts` — added `ADJUSTMENT_REASON_TYPES` (`OFFLINE_SALE` |
  `CORRECTION`) and an `adjustmentReason` field on both adjustment schemas, required
  (via `.refine`) whenever `changeType` is `DECREASE` or `ADJUST` — the two change types
  that could represent a real sale. `INCREASE` (restock), `DAMAGE`, and `RETURN` are
  already unambiguous and don't ask.
- `lib/actions/inventory.ts` — added `formatAdjustmentReason()`/`parseAdjustmentReason()`.
  The classification is encoded as a bracketed prefix on the existing free-text `reason`
  column — e.g. `"[OFFLINE_SALE] Sold in-store"` — rather than a new schema column (see
  SCHEMA GAPS). `parseAdjustmentReason()` is exported so the future Reports/Analytics
  modules read it through one function instead of each re-implementing the prefix parse;
  it returns `{ type: null, ... }` for older rows written before this convention existed,
  so callers don't mistake "not classified" for "correction."
- `components/admin/inventory/stock-adjust-dialog.tsx` — when Change Type is Decrease or
  Set Exact Quantity, the dialog now shows an "Offline Sale" / "Correction" choice with a
  one-line explanation of what each means for Reports/Analytics, and blocks submission
  until one is picked.

**Misc**
- `components/ui/badge.tsx` — added a `BEST_SELLER` tone (gold) for the new badge usage
  above.

### 3. Files Deleted

None.

### 4. Database Changes

None.

### 5. Environment Variable Changes

None.

### 6. Dependency Changes

None.

### 7. SCHEMA GAPS (documented, not migrated — per master prompt §17)

| Area | Existing capability | Missing capability | Recommended change (Phase 8) |
|---|---|---|---|
| Variant combinations | `ProductVariant.value` is one string | No structural way to filter/report by color and size independently — "Yellow / 7" is opaque to a query | Add `value2`/`variantType2` to `ProductVariant`/`Product`, or a proper `VariantOption` join |
| Offline Sale vs Correction | `InventoryLog.reason` is free text | No queryable column — this batch encodes it as a `[OFFLINE_SALE]`/`[CORRECTION]` prefix, parseable via `parseAdjustmentReason()` but not indexable/filterable at the database level | Add `StockChangeType.OFFLINE_SALE` (distinct from `ADJUST`), or a dedicated `saleClassification` column |
| Variant SKU history | New variants get an auto SKU on create | No re-generation on edit (by design — see rationale above) | None needed; documenting the deliberate choice |

### 8. POTENTIAL RISKS reviewed for this batch

- **SKU collisions on auto-generation**: `autoProductSku`/`autoVariantSku` reuse the
  existing `generateUniqueSku` collision-retry helper (the same one duplication already
  relies on), so two products/variants can never receive the same SKU even under
  concurrent creates hitting the same base string.
- **Losing stock on combination regeneration**: `generateCombinations()` in the Shoe/
  Slipper builder matches existing rows back in by exact value string before replacing
  the array — a combination that's still selected keeps its id/sku/stock/image. Only
  combinations no longer covered by the current color/size selection are dropped from
  the array, and those are archived (not deleted) by the existing `updateProduct` diff
  logic, same as manually removing a variant row.
- **Hidden fields silently reverting on edit**: verified that Brand/SKU/Barcode, now
  unregistered inputs, still round-trip through `defaultValues` on submit — a product's
  brand/barcode won't blank out just because the form no longer shows an input for them.

### 9. Testing Checklist

**Manual tests to perform on your machine (Prisma generation and `npm run build` could
not be run in this sandbox — same limitation noted in every prior batch):**
1. Create a new Bag product: confirm no Brand/SKU/Barcode/Tags/Short-Description fields
   appear; confirm Category shows only Bags/Shoes/Slippers as single-select pills.
2. With Bags selected and "Has variants" on: confirm the Colors-only builder appears (no
   variant-type dropdown), add 2–3 colors, save, confirm SKUs were auto-generated
   (check Inventory or the database).
3. Switch category to Shoes (or Slippers) with variants on: confirm the Color/Size
   checkboxes appear; test Color-only, Size-only, and Color+Size combinations; confirm
   "Generate Combinations" produces the expected cross-product rows with independent
   stock fields.
4. Edit an existing combination-variant product: confirm the color/size chip lists are
   reconstructed from the saved values, and that regenerating after adding one more color
   preserves the stock already entered for the untouched combinations.
5. Create a Bag with no variants: confirm the gallery/image upload flow is unaffected
   (unchanged from before this batch).
6. Edit an existing product that has a Brand/Barcode set (from before this batch or via
   direct DB edit): save the form with no visible way to change them, then confirm in
   the database that Brand/Barcode were NOT cleared.
7. Product page: confirm the category tabs filter correctly, and that a Best Seller
   badge and "Has variants"/"No variants" line show on both desktop rows and mobile
   cards.
8. Inventory page: confirm the same category tabs filter the list; on mobile width,
   confirm a multi-variant product's stock lines are stacked cards, not a horizontally
   scrolling table.
9. Adjust stock with Change Type = Decrease: confirm the Offline Sale/Correction choice
   is required and blocks Apply until selected; confirm Increase/Damage/Return do NOT
   show this choice. Check the resulting `InventoryLog`/`VariantInventoryLog` row's
   `reason` column for the `[OFFLINE_SALE]`/`[CORRECTION]` prefix.
10. `npm run build`.

**Known limitations:**
- Color/size chip reconstruction on edit is a best-effort parse of the saved " / "
  format — a product with unusually formatted variant values may need its chips
  re-entered once; it never discards the underlying saved variant rows either way.
- The Offline Sale/Correction distinction is not yet surfaced anywhere (Reports/
  Analytics don't exist yet — Phase D/E) — this batch only captures and encodes it
  correctly at the point of adjustment.
- Best Seller badge on Product cards reads the general `featuredFlags` list, not a
  dedicated allocation — the capped 2/1/1 (4 total) Best Sellers picker is its own
  module, planned for Phase G per the confirmed final rule.

### 10. Suggested Git Commit Messages

```
feat(products): auto-generate SKU and short description server-side, remove from form

feat(products): single-select category pills, replacing multi-checkbox picker

feat(products): category-aware variant configurator (Bag=color-only, Shoe/Slipper=color×size generator)

feat(inventory): category filter tabs, category shown per inventory card

fix(inventory): mobile variant list now stacks as cards instead of a horizontally-scrolling table

feat(inventory): Offline Sale vs Correction classification on stock decreases/adjustments

feat(admin-ui): shared CategoryFilterTabs component, BEST_SELLER badge tone
```

### 11. Documentation Updated

This file only.

### 12. Upgrade Instructions

1. Apply all file changes listed above (3 new files, all others modified in place).
2. No database migration needed.
3. `npm run build`.
4. Run through the manual testing checklist above — pay particular attention to items 6
   (hidden-field round-trip) and 9 (offline sale/correction gating), since both are new
   business-logic behavior, not just UI.
5. Commit, push.

---

## Phase A: Category Correction (Bags / Shoes / Slippers)

First step of the corrected master-prompt implementation order. No schema changes —
`Category`'s existing many-to-many model, `isActive` flag, and `slug` already fully
supported this; this batch is seed data + the previously-missing management actions/UI.

### 1. Files Added

- `prisma/migrate-categories-to-bags-shoes-slippers.ts` — one-time migration script.
  Reassigns any product on "Coach Bag" to "Bags" (unambiguous rename). Deliberately does
  **not** auto-assign products on "Rough Body" to Bags/Shoes/Slippers — there's no reliable
  way to infer which of the three a "Rough Body" product should become, and guessing wrong
  would silently mis-categorize real products. Instead it disconnects them from "Rough Body,"
  archives both old categories (`isActive: false`, not deleted — history/relationships
  preserved), and prints a list of every affected product for manual reassignment via the
  product edit form.
- `components/admin/categories/category-table.tsx` — Category management UI: create, rename,
  archive/reactivate, desktop table + mobile cards (same split pattern as Staff/Inventory).
  Archiving asks for confirmation and explicitly states that linked products are unaffected.
- `app/admin/categories/page.tsx` — Super Admin only, same page-level + middleware
  belt-and-suspenders pattern as `/admin/staff`.

### 2. Files Modified

- `prisma/seed-categories.ts` — `LAUNCH_CATEGORIES` changed from `["Coach Bag", "Rough Body"]`
  to `["Bags", "Shoes", "Slippers"]`, with explicit `sortOrder` so they list in that order
  everywhere they're rendered. Still idempotent (upsert on slug).
- `lib/actions/categories.ts` — added `listCategoriesAll()` (unfiltered, Super-Admin-only, for
  the management page — distinct from the existing active-only `listCategoriesFlat()` that
  feeds the product form/filters), `updateCategory()` (rename only — slug is intentionally
  never recomputed on rename, since it's a stable identifier used in storefront URLs), and
  `setCategoryActive()` (archive/reactivate, never deletes or touches product relationships).
  Corrected the now-stale docstring on `listCategoriesFlat()` claiming no management UI existed.
- `middleware.ts` — added `/admin/categories` to `SUPER_ADMIN_ONLY_PREFIXES`.
- `components/admin/sidebar.tsx` — added a "Categories" nav item (Super Admin only, `Tag` icon)
  between Reports and Settings.
- `package.json` — added `prisma:migrate-categories` script.

### 3. Files Deleted

None. `prisma/backfill-batch1.ts` remains formally superseded (flagged in a prior batch) but
untouched — still recommend not running it.

### 4. Database Changes

None. No migration required — `Category`'s schema already supported everything here.

### 5. Environment Variable Changes

None.

### 6. Dependency Changes

None.

### 7. Testing Checklist

**Manual tests to perform on your machine:**
1. `npm run prisma:seed-categories` — confirm Bags, Shoes, Slippers appear (Prisma Studio or
   the product form's category checkboxes), in that order.
2. If your database has products on "Coach Bag" or "Rough Body": `npm run prisma:migrate-categories`
   — confirm Coach Bag products now show "Bags," confirm the console output lists every
   Rough Body product by name for manual review, confirm both old categories now show
   `isActive: false`.
3. Manually reassign any Rough Body products listed in step 2 to Bags/Shoes/Slippers via the
   product edit form.
4. As Super Admin, open `/admin/categories` — confirm the list shows all categories including
   archived ones, with correct product counts.
5. Create a category, rename it, archive it (confirm the confirmation dialog states product
   count and that products stay linked), reactivate it.
6. As Support Admin, confirm `/admin/categories` redirects to the dashboard (both by clicking
   the — hidden — nav and by typing the URL directly).
7. Confirm the product form's category picker and the Product/Inventory page filters only ever
   show Bags/Shoes/Slippers (active categories), never the archived ones.
8. `npm run build`.

**Known limitations:**
- Same Prisma-generation sandbox limitation as every prior batch — could not run
  `prisma generate` or a full `npm run build` here; please confirm clean in your environment.
- The Rough Body → new-category mapping is manual by design (see rationale above) — this is a
  one-time admin task, not an ongoing gap.
- Category reordering (drag-and-drop `sortOrder` editing) isn't in this batch — the three
  launch categories are seeded in the right order already; flag if you want reordering UI
  before more categories are added.

### 8. Suggested Git Commit Messages

```
feat(categories): reseed launch categories as Bags/Shoes/Slippers, retire Coach Bag/Rough Body

feat(categories): one-time migration script reassigning Coach Bag products, flagging Rough Body products for manual review

feat(categories): add listCategoriesAll, updateCategory, setCategoryActive server actions

feat(admin-ui): Category management page (create/rename/archive/reactivate, desktop table + mobile cards)

fix(middleware): protect /admin/categories as Super-Admin-only

feat(admin-ui): add Categories nav item to sidebar
```

### 9. Documentation Updated

This file only.

### 10. Upgrade Instructions

1. Add the 3 new files; overwrite `prisma/seed-categories.ts`, `lib/actions/categories.ts`,
   `middleware.ts`, `components/admin/sidebar.tsx`, `package.json`.
2. `npm run prisma:seed-categories`
3. `npm run prisma:migrate-categories` (only if you have existing products on the old categories)
4. `npm run build`
5. Run through the manual testing checklist above.
6. Commit, push.

---

# CHANGES — Milestone 2: Products & Inventory

## 1. Files Added

**Validators**
- `lib/validators/product.ts` — Zod schema for Product/Variant/Spec, plus `FEATURED_FLAG_OPTIONS`
- `lib/validators/inventory.ts` — Zod schema for stock adjustments

**Server Actions**
- `lib/actions/products.ts` — createProduct, updateProduct, archiveProduct, deleteProduct, listProducts, getProduct, toggleFeaturedFlag, getCategories
- `lib/actions/inventory.ts` — adjustStock, bulkAdjustStock, listInventory, getInventoryHistory, getLowStockCount
- `lib/actions/media.ts` — uploadProductImage, deleteProductImage, reorderProductImages

**Utils**
- `lib/utils/serialize.ts` — converts Prisma `Decimal` fields to plain numbers before crossing the server→client boundary
- `lib/utils/pagination.ts` — shared skip/take/pageCount helper

**UI components**
- `components/ui/badge.tsx`
- `components/ui/pagination.tsx`
- `components/ui/search-input.tsx` (debounced)
- `components/ui/confirm-dialog.tsx`
- `components/admin/products/product-table.tsx`
- `components/admin/products/product-form.tsx`
- `components/admin/products/spec-editor.tsx`
- `components/admin/products/variant-editor.tsx`
- `components/admin/products/featured-toggles.tsx`
- `components/admin/products/image-uploader.tsx` (drag-and-drop, reorder, delete)
- `components/admin/inventory/inventory-table.tsx`
- `components/admin/inventory/stock-adjust-dialog.tsx`

**Pages**
- `app/(admin)/products/page.tsx`
- `app/(admin)/products/new/page.tsx`
- `app/(admin)/products/[id]/edit/page.tsx`
- `app/(admin)/inventory/page.tsx`

**Config**
- `.eslintrc.json` — this was missing entirely from Milestone 1; `next lint` had no config to run against. Added now using classic (non-flat) format, which is what ESLint 8.57 + `eslint-config-next` 15 expect.

## 2. Files Modified

- `app/(admin)/dashboard/page.tsx` — "Products" and "Low Stock" stat cards now pull real numbers (`prisma.product.count`, `getLowStockCount()`) instead of placeholders. Orders/Revenue cards remain placeholders until Milestone 4.
- `app/layout.tsx` — switched from a manual Google Fonts `<link>` tag to `next/font/google`. This was flagged by `next lint` (`no-page-custom-font`) and is also strictly better for performance (self-hosted, no render-blocking request). Fonts now exposed as CSS variables (`--font-display`, `--font-body`, `--font-accent`).
- `tailwind.config.ts` — `fontFamily` tokens updated to reference the new CSS variables instead of raw font names. Visual output is unchanged.
- `package.json` — added a top-level `overrides` entry pinning `@auth/core` to `0.37.2`. Without this, `@auth/prisma-adapter` and `next-auth`'s bundled `@auth/core` resolved to two different versions (0.41.3 vs 0.37.2), which broke the `Adapter` type and would have failed the build. This is a real dependency-resolution bug, not a style choice — see Known Limitations for how I confirmed it.

## 3. Files Deleted

None.

## 4. Database Changes

**No schema changes.** All models needed for this milestone (`Product`, `ProductVariant`, `ProductImage`, `ProductSpec`, `Inventory`, `InventoryLog`) were already defined in Milestone 1's `prisma/schema.prisma`.

**Migration required (if you haven't already run one):**
```bash
npx prisma migrate dev --name init
```
If you already ran this in Milestone 1, no new migration is needed for Milestone 2.

**Seed:** no changes to `prisma/seed.ts`.

## 5. Environment Variable Changes

None. `CLOUDINARY_*` was already in `.env.example` from Milestone 1 — this milestone is the first to actually use it (image upload).

## 6. Dependency Changes

**No packages added or removed.** Everything needed (`react-hook-form`, `@hookform/resolvers`, `zod`, `cloudinary`, `lucide-react`) was already in Milestone 1's `package.json`.

**One change to note:** `package.json` now has an `overrides` block (see Files Modified above). Run:
```bash
rm -rf node_modules package-lock.json
npm install
```
A plain `npm install` on top of your existing `node_modules` may not re-resolve the override cleanly — a clean reinstall is safer here.

## 7. Testing Checklist

**Features implemented:**
- [x] Product CRUD (create, edit, archive, hard-delete-if-never-ordered)
- [x] Variants (colour/size/material/pattern, own SKU/price/stock/status)
- [x] Specifications (free-form label/value pairs)
- [x] Drag-and-drop image upload to Cloudinary, reorder, delete
- [x] Homepage placement toggles (hero, best sellers, new arrivals, etc.) — no code changes needed to update the storefront once Milestone 3 wires up the public API
- [x] Inventory: current/reserved/sold/damaged/returned tracking, manual adjustments, low-stock flagging
- [x] Search, category/status filters, sorting, pagination on the product list
- [x] Bulk archive from the product list
- [x] Confirmation dialogs on archive/delete
- [x] Loading and empty states on both tables
- [x] RBAC: Cost Price field is completely absent from the form and from server responses for Support Admin — not just hidden in the UI

**Manual tests to perform on your machine:**
1. `npx prisma generate` then `npx prisma migrate dev` (see note below — I could not run this myself)
2. Log in as Super Admin → create a product with a variant, a spec, and two images → confirm it saves and images appear in the right order
3. Log in as Support Admin (seed one via Prisma Studio if you haven't) → open the same product → confirm the Cost Price field shows "Visible to Super Admin only" and that editing/saving the product does **not** change costPrice in the database (check via Prisma Studio)
4. Toggle a homepage flag (e.g. "Best Sellers") on/off → confirm `featuredFlags` updates in the DB
5. Go to Inventory → adjust stock with each change type (Increase, Decrease, Set exact, Damage, Return) → confirm `currentStock` and the corresponding counter (`damagedStock`/`returnedStock`) update correctly, and that an `InventoryLog` row is created each time
6. Try deleting a product that has never been ordered → should succeed. (There's no order data yet to test the "has order history, cannot delete" path — that becomes testable in Milestone 4.)
7. Search, filter by category, filter by status, and paginate the product list with more than one page of results
8. Select multiple products via checkbox → "Archive selected" → confirm all update

**Known limitations:**
- **I could not run `npx prisma generate` or a full `next build` in my sandbox** — the engine binary download is blocked by my environment's network egress rules (it tries to reach `binaries.prisma.sh`, which isn't on my allowed domain list). This means:
  - `npx tsc --noEmit` currently shows 6 errors, all "`@prisma/client` has no exported member [X]" (`StaffRole`, `ProductVariant`). These are not code bugs — they're the expected result of an ungenerated Prisma client. They should disappear the moment you run `npx prisma generate` in your environment.
  - I was not able to run a full `next build` to catch anything beyond what `tsc` and `next lint` catch. Please run `npm run build` locally before pushing, and let me know if anything comes up — I'd rather fix it now than have you discover it later.
- I did catch and fix one real bug this way: the `@auth/core` version mismatch described above. I only found it because I ran a clean `npm install` and inspected `node_modules` directly — I'm flagging this so you know that level of check did happen, even though the Prisma-side check didn't fully complete.
- Bulk actions currently support "Archive" only (no bulk delete, bulk status change, or bulk export yet) — can extend if you want that in a later milestone.
- No image cropping in the uploader yet (spec called for "Crop Images") — currently supports upload, delete, reorder, and preview. Cropping needs a client-side crop library (e.g. `react-image-crop`) — flagging as a deliberate scope cut for this milestone rather than an oversight; let me know if you want it added now or later.

## 8. Suggested Git Commit Messages

```
feat(products): add Zod validators for product, variant, and spec input

feat(inventory): add Zod validator for stock adjustments

feat(products): server actions for product CRUD, RBAC-enforced financial field stripping

feat(inventory): server actions for stock adjustment, bulk update, low-stock query

feat(media): Cloudinary product image upload/delete/reorder server actions

feat(ui): reusable badge, pagination, search input, and confirm dialog components

feat(products): product list table with search, filters, sort, pagination, bulk archive

feat(products): role-aware product form (Cost Price hidden for Support Admin)

feat(products): variant editor, spec editor, homepage featured-flag toggles

feat(products): drag-and-drop image uploader with reorder and delete

feat(inventory): inventory table and stock-adjust dialog

feat(products): products list, new, and edit admin pages

feat(inventory): inventory admin page

feat(dashboard): wire real Product and Low Stock counts

fix(auth): pin @auth/core version to resolve Adapter type conflict between next-auth and @auth/prisma-adapter

fix(fonts): switch to next/font/google to resolve no-page-custom-font lint warning and improve load performance

chore(lint): add missing ESLint config (classic format for ESLint 8 + eslint-config-next 15)
```

## 9. Documentation Updated

- This file (`CHANGES.md`) is new for this milestone.
- `README.md` — not yet updated with Milestone 2 instructions; doing that now as part of this delivery (see below).

## 10. Upgrade Instructions (apply to your existing project)

1. Copy all "Added" files into your project at the paths listed above, preserving directory structure.
2. Apply the "Modified" files — these are full-file replacements, not diffs, so just overwrite.
3. Run:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npx prisma generate
   npx prisma migrate dev   # only if you haven't already run a migration
   npm run build            # confirm it's clean in your environment
   ```
4. Run through the manual testing checklist above.
5. Commit using the grouped messages above (or your own), then push.

# Giftij Brandy Admin Portal — Changelog

Running log, newest entry first. Each milestone/batch appends a new section at
the top rather than replacing this file — that's the fix for the "which
CHANGES.md do I keep" problem from Batch 1.

---

## Milestone 3, Batch 1: Schema Migration & Shared API Infrastructure

### 1. Files Added

**Schema & migration**
- `prisma/backfill-batch1.ts` — one-time backfill/seed script (see §Database Changes)

**Shared API infrastructure**
- `lib/api/api-error.ts` — `ApiError` class + error code registry
- `lib/api/respond.ts` — `ok()`/`fail()` response envelope helpers
- `lib/api/cors.ts` — CORS headers for `/api/v1/public/*`
- `lib/api/rate-limit.ts` — in-memory rate limiter (MVP-scoped, documented limitation)

**Collections abstraction**
- `lib/collections/featured-flags-provider.ts` — swappable provider interface over `featuredFlags`, canonical `FEATURED_FLAG_OPTIONS` list now lives here

**Utilities**
- `lib/utils/slug.ts` — slug generation + uniqueness helper
- `lib/utils/product-lifecycle.ts` — explicit DRAFT→ACTIVE→ARCHIVED transition validator

**Validators**
- `lib/validators/public/products.ts` — public product list/detail query validation
- `lib/validators/public/categories.ts` — public category list query validation

**Actions**
- `lib/actions/categories.ts` — `listCategoriesFlat()`, `createCategory()` (Super Admin only)

### 2. Files Modified

- `prisma/schema.prisma` — see §Database Changes, the substantial change this batch
- `lib/validators/product.ts` — `category`/`subcategory` strings replaced by `categoryId`; added optional `slug` field; `FEATURED_FLAG_OPTIONS` now re-exported from `lib/collections/featured-flags-provider.ts` instead of being defined locally
- `lib/actions/products.ts` — `createProduct` generates a slug via `lib/utils/slug.ts` when none is provided; `updateProduct` and `archiveProduct` now call `assertValidProductTransition()` before persisting a status change; all `category`/`subcategory` references replaced with `categoryId`; `listProducts`/`getProduct` now include the `category` relation; old string-based `getCategories()` removed (replaced by `lib/actions/categories.ts::listCategoriesFlat`)
- `lib/cloudinary.ts` — `uploadImage()` now returns `width`/`height`/`format` from Cloudinary's own response instead of discarding them
- `lib/actions/media.ts` — `uploadProductImage` stores the new metadata fields and sets `imageType` (first product image → `COVER`, subsequent → `GALLERY`, variant-attached → `VARIANT`); `deleteProductImage` promotes the next image to `COVER` if the cover was deleted; `reorderProductImages` keeps `imageType` in sync with the new order
- `components/admin/products/product-form.tsx` — Category/Subcategory free-text inputs replaced with a Category dropdown (populated from the new `categories` prop) and an optional URL Slug field
- `components/admin/products/product-table.tsx` — `categories` prop and filter dropdown now use `{id, name, slug}` objects instead of raw strings; category filter now sends `categoryId`
- `app/(admin)/products/page.tsx` — uses `listCategoriesFlat()` instead of the retired `getCategories()`
- `app/(admin)/products/new/page.tsx` — fetches and passes `categories` to `ProductForm`
- `app/(admin)/products/[id]/edit/page.tsx` — fetches `categories`, maps `defaultValues` to `categoryId`/`slug` instead of `category`/`subcategory`
- `.env.example` — added `PUBLIC_API_ALLOWED_ORIGINS`
- `package.json` — added `prisma:backfill-batch1` script

### 3. Files Deleted

None — `getCategories()` was removed as a function from `lib/actions/products.ts`, but the file itself remains (see Modified above).

### 4. Database Changes

**This is the substantial part of Batch 1. Read this whole section before migrating.**

### Schema changes
- **New `Category` model** — self-referencing hierarchy (`parentId`), `slug` unique, `isActive`, `sortOrder`
- **`Product`**: `+ slug` (unique, required); `category`/`subcategory` string fields **removed**, replaced by `categoryId` (required FK to `Category`)
- **New `ImageType` enum** (`COVER`/`GALLERY`/`VARIANT`)
- **`ProductImage`**: `+ altText`, `+ width`, `+ height`, `+ format`, `+ imageType` (default `GALLERY`)
- **`ActivityLog`**: `userId` is now optional (was required); `+ systemSource` for webhook/cron-originated log entries

### ⚠️ Migration order — read this before running `prisma migrate dev`

`Product.categoryId` is a **required** field on a table that, in your current database, has zero or more existing rows with no category assignment. This determines which path applies to you:

**Path A — your only Product rows are Milestone 2 test data (recommended, and what I'd expect at this stage):**
```bash
# 1. Clear test products (they were disposable QA data anyway)
#    Easiest via Prisma Studio: npx prisma studio, delete rows from Product
#    (cascades will clean up related Inventory/Images/etc.)

# 2. Apply the migration
npx prisma migrate dev --name batch1_categories_slugs_images

# 3. Seed starter categories (since there's no legacy data to backfill from)
npm run prisma:backfill-batch1
```

**Path B — you have real product data you need to preserve:**
Stop before running `prisma migrate dev` with this schema and tell me. The
migration needs to be split into two steps (add `categoryId` as nullable
first, backfill data, then a follow-up migration making it required and
dropping the old columns) rather than the single migration this schema
implies. I didn't build that two-step version because I believe you're in
Path A at this stage of the project — but I'm not certain, so confirming
before you run anything against data you care about is the safe move.

### Seed
No changes to `prisma/seed.ts` (Super Admin creation unaffected). New script `prisma/backfill-batch1.ts` — see above.

### 5. Environment Variable Changes

- `+ PUBLIC_API_ALLOWED_ORIGINS` — comma-separated list, defaults to `https://www.giftij.com,https://giftij.com` if unset. Add your local/preview storefront URL here for local testing in Batch 2.

### 6. Dependency Changes

None. No new packages required for this batch.

### 7. Testing Checklist

**Features implemented:**
- [x] `Category` model with hierarchy support
- [x] `Product.slug`, auto-generated on create, editable, uniqueness-checked
- [x] Explicit product lifecycle validation (DRAFT→ACTIVE→ARCHIVED, with ARCHIVED able to revert) — enforced in `updateProduct`/`archiveProduct`, not just accepted as any string
- [x] Cloudinary image metadata (`altText`/`width`/`height`/`format`) captured and stored, no longer discarded
- [x] `imageType` auto-assignment (`COVER` for first image, `GALLERY` for rest, `VARIANT` for variant-attached), with cover-promotion on delete and sync on reorder
- [x] `featuredFlags` collections now go through a swappable provider interface
- [x] `ActivityLog` supports system-originated entries (`userId` optional + `systemSource`) — not yet actually used by anything (no webhooks/cron exist until Batch 3/Milestone 4), but the schema and the field are ready
- [x] Shared API response envelope, error codes, CORS, and rate-limiting infrastructure — not yet wired into any route (that's Batch 2), but built and ready
- [x] Admin product form now uses a real Category dropdown instead of free text

**Manual tests to perform on your machine:**
1. Follow the migration path (A or B) that matches your actual database state — see above
2. `npm run prisma:generate`, `npm run build` — confirm clean (I could not verify `prisma generate` myself, same sandbox limitation as every prior milestone)
3. Log in, go to Products → New Product → confirm the Category dropdown is populated (from the backfill seed if you went Path A) and required
4. Create a product, leave the Slug field blank → confirm it auto-generates a sensible slug from the name
5. Create a second product with the same name → confirm the slug gets a `-2` suffix rather than colliding
6. Edit a product and try to set an invalid status jump if you construct one manually (there's no way to do this through the UI currently since the dropdown only offers valid Prisma enum values — this is really testing that the lifecycle validator doesn't reject *normal* transitions like DRAFT→ACTIVE, which it shouldn't)
7. Upload 3 images to a product → confirm the first is marked cover (visually, in the uploader), delete it, confirm the next one takes over as cover
8. Reorder images via drag-and-drop → confirm whichever is now first becomes the visual cover

**Known limitations:**
- Same Prisma-generation sandbox limitation as every prior milestone — I verified `next lint` (clean) and `tsc --noEmit` (only the expected Prisma-client-not-generated errors, nothing new) but could not run `prisma generate` or a full `npm run build` myself.
- No Category management UI yet (create/edit/reorder/deactivate from the dashboard) — categories are seeded via the backfill script for now. Flagging this as likely needed before Batch 2's public API goes live with real data, but wasn't explicitly in Batch 1's scope — let me know if you want it pulled forward.
- `altText` on images has no admin-facing edit UI yet — the field exists and is captured/stored, but there's no input for a staff member to customize it (falls back to null currently, not even the product name). Small follow-up if you want it before Batch 2.
- The rate limiter is in-memory per serverless instance — documented as an accepted MVP limitation in the architecture doc, not a bug, but flagging again here since Batch 2 is where it starts actually being used.

### 8. Suggested Git Commit Messages

```
feat(db): add Category model, Product.slug, ProductImage metadata/imageType, ActivityLog system events

feat(lib): slug generation and product lifecycle transition validator

feat(collections): swappable featuredFlags provider abstraction

feat(api): shared response envelope, error codes, CORS, and rate-limit infrastructure

feat(validators): public API query validators for products and categories

feat(categories): category read/create server actions

feat(products): wire categoryId, slug generation, and lifecycle validation into product actions

feat(media): capture Cloudinary image metadata, auto-assign imageType, cover-image promotion on delete

feat(admin-ui): category dropdown and slug field replace free-text category/subcategory inputs

chore(env): add PUBLIC_API_ALLOWED_ORIGINS, backfill script

fix(lint): escape apostrophe in product form empty-state copy

fix(types): remove implicit any in featured-flags provider
```

### 9. Documentation Updated

This file (`CHANGES.md`) — new for this batch. `README.md` not yet updated with Batch 1 notes; will do that together with Batch 2 once the public endpoints exist, so the README's "what's live" section reflects a complete, testable slice rather than half a batch.

### 10. Upgrade Instructions

1. **Before copying any files**, decide Path A or Path B above based on your actual database state, and follow the relevant steps.
2. Copy all Added/Modified files into your project at the paths listed, preserving directory structure.
3. Run:
   ```bash
   npx prisma migrate dev --name batch1_categories_slugs_images
   npm run prisma:backfill-batch1   # if Path A
   npx prisma generate
   npm run build
   ```
4. Run through the manual testing checklist above.
5. Commit using the grouped messages above (or your own), then push.

---

## Milestone 2: Products & Inventory

### 1. Files Added

**Validators**
- `lib/validators/product.ts` — Zod schema for Product/Variant/Spec, plus `FEATURED_FLAG_OPTIONS`
- `lib/validators/inventory.ts` — Zod schema for stock adjustments

**Server Actions**
- `lib/actions/products.ts` — createProduct, updateProduct, archiveProduct, deleteProduct, listProducts, getProduct, toggleFeaturedFlag, getCategories
- `lib/actions/inventory.ts` — adjustStock, bulkAdjustStock, listInventory, getInventoryHistory, getLowStockCount
- `lib/actions/media.ts` — uploadProductImage, deleteProductImage, reorderProductImages

**Utils**
- `lib/utils/serialize.ts` — converts Prisma `Decimal` fields to plain numbers before crossing the server→client boundary
- `lib/utils/pagination.ts` — shared skip/take/pageCount helper

**UI components**
- `components/ui/badge.tsx`
- `components/ui/pagination.tsx`
- `components/ui/search-input.tsx` (debounced)
- `components/ui/confirm-dialog.tsx`
- `components/admin/products/product-table.tsx`
- `components/admin/products/product-form.tsx`
- `components/admin/products/spec-editor.tsx`
- `components/admin/products/variant-editor.tsx`
- `components/admin/products/featured-toggles.tsx`
- `components/admin/products/image-uploader.tsx` (drag-and-drop, reorder, delete)
- `components/admin/inventory/inventory-table.tsx`
- `components/admin/inventory/stock-adjust-dialog.tsx`

**Pages**
- `app/(admin)/products/page.tsx`
- `app/(admin)/products/new/page.tsx`
- `app/(admin)/products/[id]/edit/page.tsx`
- `app/(admin)/inventory/page.tsx`

**Config**
- `.eslintrc.json` — was missing entirely from Milestone 1; added using classic (non-flat) format for ESLint 8 + `eslint-config-next` 15.

### 2. Files Modified

- `app/(admin)/dashboard/page.tsx` — "Products" and "Low Stock" stat cards pull real numbers instead of placeholders.
- `app/layout.tsx` — switched from a manual Google Fonts `<link>` tag to `next/font/google`.
- `tailwind.config.ts` — `fontFamily` tokens updated to reference the new CSS variables.
- `package.json` — added a top-level `overrides` entry pinning `@auth/core` to `0.37.2` (real dependency-resolution bug between `next-auth` beta and `@auth/prisma-adapter`, would have broken the build otherwise).

### 3. Files Deleted

None.

### 4. Database Changes

No schema changes — all models needed (`Product`, `ProductVariant`, `ProductImage`, `ProductSpec`, `Inventory`, `InventoryLog`) already existed from Milestone 1.

### 5. Environment Variable Changes

None.

### 6. Dependency Changes

No packages added or removed. `overrides` block added to `package.json` (see Files Modified) — required a clean `node_modules`/`package-lock.json` reinstall.

### 7. Testing Checklist (summary)

- Product CRUD, variants, specs, drag-and-drop Cloudinary image upload/reorder/delete
- Homepage placement toggles
- Inventory tracking (current/reserved/sold/damaged/returned), manual adjustments, low-stock flagging
- Search, category/status filters, sorting, pagination, bulk archive
- RBAC verified: Cost Price field absent from both the form and server responses for Support Admin

### 8. Known Limitations (as of Milestone 2)

- Could not run `npx prisma generate` or a full `next build` in the build sandbox at the time — engine binary download blocked (later resolved once verified in your local environment).
- No image cropping in the uploader (upload/delete/reorder/preview only).

### 9. Suggested Git Commit Messages

```
feat(products): add Zod validators for product, variant, and spec input
feat(inventory): add Zod validator for stock adjustments
feat(products): server actions for product CRUD, RBAC-enforced financial field stripping
feat(inventory): server actions for stock adjustment, bulk update, low-stock query
feat(media): Cloudinary product image upload/delete/reorder server actions
feat(ui): reusable badge, pagination, search input, and confirm dialog components
feat(products): product list table with search, filters, sort, pagination, bulk archive
feat(products): role-aware product form (Cost Price hidden for Support Admin)
feat(products): variant editor, spec editor, homepage featured-flag toggles
feat(products): drag-and-drop image uploader with reorder and delete
feat(inventory): inventory table and stock-adjust dialog
feat(products): products list, new, and edit admin pages
feat(inventory): inventory admin page
feat(dashboard): wire real Product and Low Stock counts
fix(auth): pin @auth/core version to resolve Adapter type conflict between next-auth and @auth/prisma-adapter
fix(fonts): switch to next/font/google to resolve no-page-custom-font lint warning
chore(lint): add missing ESLint config (classic format for ESLint 8 + eslint-config-next 15)
```

---

## Pre-Launch Schema Finalization: Many-to-Many Categories & Admin-Defined Variants

Application code update following the final `schema.prisma` (Category M-N, admin-defined
`variantType`, per-variant inventory). This is the code pass that was flagged as required
after that schema was delivered — the app would not have built against it before this.

### 1. Files Added

- `lib/constants/variant-types.ts` — preset variant type list (`Colour`, `Size`,
  `Material`) for the admin dropdown, plus the `Other` sentinel. Purely a UI convenience —
  the database stores whatever string results, preset or custom.
- `components/admin/products/category-select.tsx` — multi-select checkboxes replacing
  the old single category dropdown
- `components/admin/products/variants-section.tsx` — replaces `variant-editor.tsx`.
  Handles the "has variants?" toggle, variant type selection (preset dropdown or custom
  "Other" input), and the list of variant values, each with its own SKU, stock, and
  single-image upload.

### 2. Files Deleted

- `components/admin/products/variant-editor.tsx` — replaced by `variants-section.tsx`

### 3. Files Modified

- `lib/validators/product.ts` — `categoryId` → `categoryIds: string[]` (min 1);
  `variantSchema` reduced to `value`/`sku`/`stock`/`status` (no more `color`/`size`/
  `material`/`pattern`/`price`); added `hasVariants: boolean` and `variantType:
  string | null` with cross-field validation (`.refine()`) ensuring a variant type and
  at least one variant are present when `hasVariants` is true, and that variants aren't
  silently orphaned when it's false
- `lib/validators/inventory.ts` — added `adjustVariantStockSchema`, parallel to the
  existing base-inventory one
- `lib/actions/products.ts` — `categories: { connect/set }` instead of a single FK;
  variant create/update writes `value`/`currentStock` instead of the removed fields;
  base `Inventory` is only created when `!hasVariants`; `updateProduct` now refuses to
  turn variants off while variant rows still exist, rather than silently orphaning them
- `lib/actions/inventory.ts` — added `adjustVariantStock()` and
  `getVariantInventoryHistory()`; `listInventory()` now paginates by **product**, not by
  inventory row, returning each product's base stock or its full variant list grouped
  together; `getLowStockCount()` now accounts for variant-level stock too
- `lib/actions/media.ts` — added `uploadVariantImage()`, which **replaces** an existing
  variant image rather than erroring (matches the schema's one-image-per-variant
  constraint as a smooth replace, not a hard stop the admin has to work around manually)
- `lib/utils/serialize.ts` — removed variant `price` serialization (field no longer exists)
- `components/admin/products/product-form.tsx` — category dropdown → `CategorySelect`;
  `VariantEditor` → `VariantsSection`; wrapped in `FormProvider` so the variants section
  can use `useFormContext`; Initial Stock field now hidden when the product has variants
- `components/admin/products/product-table.tsx` — category column shows a joined list
  instead of one name; stock column aggregates variant stock when present
- `components/admin/inventory/inventory-table.tsx` — restructured to group by product,
  with variant stock shown as sub-rows under their parent product (matches "Pedro Bag:
  Black-6, Blue-3, Yellow-1" grouped together, not as unrelated rows)
- `components/admin/inventory/stock-adjust-dialog.tsx` — now accepts a `target` (base
  product or specific variant) instead of always assuming base inventory; also fixed the
  same async-inside-`startTransition` anti-pattern flagged and fixed elsewhere in
  Milestone 2/3 — this file had been missed in that earlier pass
- `app/(admin)/products/[id]/edit/page.tsx` — `defaultValues` mapping rewritten for
  `categoryIds`, `hasVariants`, `variantType`, and the new variant shape
- `lib/api/public-product-select.ts` — `category` → `categories` array in both select
  clauses and DTOs; `ProductDetail` DTO gains `variantType`; variant DTO simplified to
  `{ sku, value, inStock, image }`; sold-out variants stay visible (filtered only by
  `status !== ARCHIVED`, never by stock level) — per the confirmed business rule that
  out-of-stock variants remain visible so customers know they exist
- `app/api/v1/public/products/route.ts` — category filter now queries
  `categories: { some: { slug } }` instead of a direct FK match
- `docs/API_CONTRACT.md`, `docs/openapi.yaml` — updated for the many-to-many category
  shape, `variantType`, and the simplified variant object, across the Data Model
  Reference, both JSON examples, and the OpenAPI schemas

### 4. Database Changes

None new — this batch is the application code catching up to the `schema.prisma`
delivered previously. See that delivery's own notes for the migration path.

### 5. Environment Variable Changes

None.

### 6. Dependency Changes

None.

### 7. Testing Checklist

**Features implemented:**
- [x] Admin can select multiple categories per product
- [x] Admin can toggle "has variants," pick a preset type or enter a custom one, and add
      variant values with independent stock and a single optional image each
- [x] Inventory page groups variant stock under its parent product
- [x] Stock adjustment works against either base inventory or a specific variant, with
      its own audit trail (`VariantInventoryLog`) either way
- [x] Public API returns `categories` (array) and `variantType` + simplified `variants`
- [x] Sold-out variants remain visible in the API response (not filtered out by stock)

**Manual tests to perform on your machine:**
1. `npx prisma generate && npm run build`
2. Create a product with variants: toggle "has variants" on, pick "Colour," add
   Black/Blue/Yellow with different stock counts, save. Confirm the product list shows
   aggregated stock across all three.
3. Try turning "has variants" back off on that product without removing the variants
   first — confirm it's rejected with a clear message, not silently ignored
4. Go to Inventory — confirm the product shows as one row with three variant sub-rows,
   each independently adjustable
5. Adjust one variant's stock (e.g. RETURN +2 on Blue) — confirm only that variant's
   count changes, the others are untouched, and a `VariantInventoryLog` entry exists
6. Upload an image to a variant, then upload a second one to the same variant — confirm
   the first is replaced (old Cloudinary asset gone), not duplicated
7. `curl` `GET /api/v1/public/products/:slug` on a variant product — confirm `variantType`
   is present, `variants[]` has no stock counts (only `inStock` boolean), and a
   zero-stock variant still appears in the array with `inStock: false`
8. Assign a product to 2+ categories, confirm `GET /api/v1/public/products?category=X`
   returns it for each category it belongs to

**Known limitations:**
- Same Prisma-generation sandbox limitation as every prior batch — `next lint` clean,
  `tsc --noEmit` shows only the expected "Prisma client not generated" class of error.
- Turning "has variants" off is blocked while variants exist, requiring the admin to
  remove them one at a time first — no bulk "convert to non-variant product" action.
  Reasonable friction for what should be a rare operation; flag if you want it smoothed
  out later.
- Milestone 4 (checkout) will need `reservedStock` semantics wired up for variants the
  same way they're planned for base inventory — schema already supports it
  (`ProductVariant.reservedStock` exists), just not used by anything yet.

### 8. Suggested Git Commit Messages

```
feat(constants): add variant type presets for the admin UI

feat(products): categoryIds array and admin-defined variantType in the validator

feat(inventory): add variant-level stock adjustment validator

feat(products): rewire product actions for many-to-many categories and variant-based inventory

feat(inventory): variant-aware stock adjustment, grouped-by-product inventory listing

feat(media): replace-on-reupload for variant images (one image per variant, enforced)

fix(serialize): remove variant price serialization, field no longer exists

feat(admin-ui): category multi-select and admin-defined variant type/value editor

feat(admin-ui): grouped product/variant inventory table, target-flexible stock adjust dialog

fix(admin-ui): fix async-in-startTransition in stock-adjust-dialog (missed in earlier pass)

feat(api): categories array, variantType, and simplified variant shape in public product API

docs: update API contract and OpenAPI spec for many-to-many categories and admin-defined variants
```

### 9. Documentation Updated

`docs/API_CONTRACT.md` and `docs/openapi.yaml` — both updated in this batch, described above.

### 10. Upgrade Instructions

1. Copy all Added/Modified files into your project at the paths listed; delete
   `variant-editor.tsx`.
2. `npx prisma generate && npm run build`
3. Run through the manual testing checklist above.
4. Commit using the grouped messages above (or your own), then push.

---
## Mobile & UX Enhancement — Batch 1: Mobile Shell

Working from the uploaded, Neon-verified baseline (not reconstructed from memory). First batch
of the approved mobile/UX specification — the hamburger sidebar, top bar, and dashboard grid.

### 1. Files Added

- `components/admin/mobile-topbar.tsx` — mobile-only top bar: hamburger button, "Giftij Brandy
  Admin" wordmark, notification bell (placeholder — no notification system exists yet, matches
  the spec's own "(notification icon placeholder)" wording), and a profile avatar showing the
  signed-in staff member's initials
- `components/admin/admin-shell.tsx` — new client wrapper holding the mobile sidebar
  open/closed state and composing `MobileTopBar` + `Sidebar` + backdrop + main content. This
  replaces the layout's previous direct `<Sidebar /><main>` rendering.

### 2. Files Modified

- `components/admin/sidebar.tsx` — now accepts `mobileOpen`/`onCloseMobile` props. Desktop
  behavior is pixel-identical to before (`md:relative md:translate-x-0`, always visible).
  Mobile: fixed, slides in from the left (`-translate-x-full` → `translate-x-0`) with a close
  (X) button, and auto-closes when a nav link is tapped (so the drawer doesn't stay open over
  the page you just navigated to).
- `app/admin/layout.tsx` — now renders `<AdminShell>` instead of directly laying out
  `Sidebar` + `main`. Passes `userName` through for the mobile top bar's avatar initials.

### 3. Files Deleted

None.

### 4. Already Satisfied — No Change Made

- **Dashboard 2-per-row mobile grid**: `app/admin/dashboard/page.tsx` already uses
  `grid-cols-2 md:grid-cols-4`, which produces exactly the 2-per-row mobile / 4-per-row
  desktop layout the spec asks for. Verified against the actual file rather than assumed;
  no change needed or made.

### 5. Database Changes

None.

### 6. Environment Variable Changes

None.

### 7. Dependency Changes

None — `lucide-react` (already a dependency) provides the `Menu`, `X`, and `Bell` icons used.

### 8. Testing Checklist

**Features implemented:**
- [x] Sidebar hidden by default on mobile, hamburger-triggered slide-in
- [x] Mobile top bar: hamburger, logo, notification placeholder, avatar
- [x] Backdrop closes the drawer on outside tap; X button and nav-link taps also close it
- [x] Desktop layout unchanged (verified: same classes minus the mobile-only transform logic)

**Manual tests to perform on your machine:**
1. `npm run build`, then check both desktop (≥768px) and mobile (<768px) viewport widths
2. Desktop: confirm the sidebar looks and behaves exactly as before — no visual regression
3. Mobile: confirm the sidebar is gone by default, top bar shows hamburger/logo/bell/avatar
4. Tap the hamburger — sidebar slides in from the left over a dark backdrop
5. Tap a nav link — confirms navigation works AND the drawer closes automatically
6. Reopen, tap the backdrop (not the drawer) — confirms it closes without navigating
7. Reopen, tap the X button inside the drawer — same close behavior
8. Confirm the avatar shows your actual initials (e.g. "Bright" → "B")

**Known limitations:**
- Same Prisma-generation sandbox limitation as every prior batch — `next lint` clean,
  `tsc --noEmit` shows the same known error class (one more instance than before, since
  `admin-shell.tsx` also imports the `StaffRole` type — not a new category of issue).
- Notification bell is a non-functional placeholder, exactly as the spec requested — no
  backend notification system exists to wire it to yet.

### 9. Suggested Git Commit Messages

```
feat(admin-ui): mobile-responsive sidebar with slide-in drawer behavior

feat(admin-ui): mobile top bar (hamburger, logo, notification placeholder, avatar)

feat(admin-ui): AdminShell wrapper holding mobile nav state, replaces direct layout composition
```

### 10. Documentation Updated

None this batch.

### 11. Upgrade Instructions

1. Copy the two new files into place, overwrite the two modified files.
2. `npm run build`
3. Run through the manual testing checklist above at both viewport sizes.
4. Commit, push.

---

## Product Form Refinement & Category Seed

Targeted fixes on top of Batch 3, per your explicit UX corrections. No schema changes — the
underlying data model (Category, ProductVariant, Inventory) already fully supported everything
requested; this was UI-layer and seed-data work only. Full inspection notes below.

### 1. Files Modified

- `components/admin/products/product-form.tsx`:
  - **Reverted mobile grid collapse for genuinely comfortable short-field pairs**: SKU/Barcode
    and the Price/Cost/Discount/Currency group are back to a fixed `grid-cols-2` (side-by-side
    even on mobile), per your explicit examples. Product Specifications' Weight/Dimensions/
    Warranty group is also back to fixed 2-column, now that SEO and Initial Stock have moved
    out of it (see below) leaving just three short fields.
  - **SEO split into its own standalone section**, no longer merged into Specifications/
    Logistics.
  - **Initial Stock moved out of Specifications entirely** — it now lives inside the Variants
    section itself (see below), directly next to the "has variants" toggle that determines
    whether it's even relevant.
  - **Section order now matches the requested flow**: Core Details → Pricing →
    Specifications → (custom Specs) → Variants/Inventory → Homepage Placement → SEO.
  - Removed the now-unused `watch("hasVariants")` — `VariantsSection` manages that state
    internally already, this was dead code.

- `components/admin/products/variants-section.tsx`:
  - **Real bug fixed**: the variant values list (and "+ Add" button) previously appeared as
    soon as "has variants" was checked, *before* a variant type was selected — contradicting
    the explicit requirement that values only appear after a type is chosen. Now gated behind
    `!!variantType` as well.
  - **Explicit stock-transition messaging added**: when variants are enabled, a note now reads
    "Stock will be managed per variant below — the product no longer has one combined stock
    count," directly in the card, not just implied by field disappearance.
  - **Initial Stock now lives here** (create mode only) — in the "off" (no variants) state,
    right where the toggle that governs it sits. In edit mode, a non-variant product instead
    shows "Stock is managed from the Inventory page" with a link (reusing the `#product-<id>`
    deep-link already built in the Navigation batch), since stock changes for existing
    non-variant products go through the Inventory page's audit-logged adjustment flow, not a
    raw field on the product form.

### 2. Files Added

- `prisma/seed-categories.ts` — idempotent (upsert-on-slug) seed for exactly the two real
  launch categories: **Coach Bag** and **Rough Body**. Safe to run repeatedly, safe to run
  alongside any other categories that may already exist — it only ever touches these two.
  Supersedes `prisma/backfill-batch1.ts`'s generic placeholder category list, which is now
  formally superseded (that file was already flagged obsolete when the Category model became
  many-to-many; recommend deleting it rather than running it, to avoid confusion between the
  two).

### 3. Package Script Added

- `npm run prisma:seed-categories` → runs the new seed script.

### 4. Inspection Findings (per your required verification step)

**Already correct, confirmed by inspection, no changes made:**
- `Category` model already has `name`/`slug`/`isActive` (archive)/`parentId` (hierarchy) and a
  many-to-many relation to `Product` — fully supports "add/edit/archive category" and
  "products can belong to one or more categories" with zero schema work.
- `listCategoriesFlat()` / `createCategory()` already exist in `lib/actions/categories.ts`.
  Category selection in the product form already reads live from the database — never
  hardcoded, confirmed by re-reading `category-select.tsx` and its data source.
- `ProductVariant`/`Inventory` models already correctly separate variant-owned stock from
  base-product stock, with independent audit trails (`VariantInventoryLog`/`InventoryLog`).
  No parallel/competing stock source exists at the schema level.
- Archiving a category does not touch product relationships — the many-to-many join table
  rows are untouched by `isActive` toggling, so existing product-category assignments survive
  an archive exactly as required.

**Gaps found and fixed (detailed above):** variant values appearing before type selection,
missing stock-transition messaging, SEO/Initial Stock placement, and the two categories not
being seeded anywhere with the correct names.

**Not built, not requested by this message**: full Category Management admin page
(view/add/edit/archive UI). The action functions this would need only partially exist
(`listCategoriesFlat`, `createCategory` — no `updateCategory`/`archiveCategory` yet). You've
referred to this as something the admin should "eventually" have — treating it as still
deferred (previously scoped as its own batch) rather than assuming it's wanted now. Flag if
you want it pulled forward.

### 5. Database Changes

None. No migration required — confirmed by inspection that the existing schema already
supports every behavior requested.

### 6. Environment Variable Changes

None.

### 7. Dependency Changes

None.

### 8. Testing Checklist

**Manual tests to perform on your machine:**
1. `npx prisma generate && npm run build`
2. `npm run prisma:seed-categories` — confirm both categories appear (check via the product
   form's category checkboxes, or Prisma Studio)
3. New product, don't enable variants — confirm Initial Stock now appears inside the Variants
   card (not Specifications), and that a plain stock number saves correctly
4. Enable variants, select a type — confirm the values list does **not** appear until a type
   is actually chosen, and that the "stock will be managed per variant" message shows
5. Desktop: confirm SKU/Barcode and Price/Cost/Discount/Currency are still side-by-side, same
   as before Batch 3's mobile changes ever touched them
6. Mobile (<768px): confirm those same short-field pairs are *comfortably* side-by-side (not
   cramped/overflowing) — this is the judgment call worth double-checking on an actual small
   screen, not just a browser devtools resize
7. Confirm SEO is now its own card, separate from Specifications
8. Edit an existing non-variant product — confirm the "Stock is managed from the Inventory
   page" link appears and correctly deep-links to that product's inventory row

**Known limitations:**
- Same Prisma-generation sandbox limitation as every prior batch — clean `next lint`,
  `tsc --noEmit` at the same known count (17), nothing new.
- "Comfortable side-by-side on mobile" for SKU/Barcode and Price/Cost/Discount/Currency is a
  judgment call on my part based on your examples — genuinely worth checking on a real small
  screen (or narrow devtools viewport) rather than assuming it's right; easy to flip back to
  responsive single-column for a specific pair if any of them feel cramped in practice.

### 9. Suggested Git Commit Messages

```
fix(variants): gate variant values list behind variant type selection

feat(variants): add explicit stock-transition messaging, move Initial Stock into this section

fix(product-form): revert mobile grid collapse for comfortable short-field pairs

feat(product-form): split SEO into its own standalone section

refactor(product-form): reorder sections to match requested flow (Variants before Homepage Placement)

feat(seed): add idempotent seed script for Coach Bag and Rough Body categories
```

### 10. Documentation Updated

None this batch.

### 11. Upgrade Instructions

1. Overwrite `product-form.tsx`, `variants-section.tsx`, `package.json`; add `seed-categories.ts`.
2. `npm run build`
3. `npm run prisma:seed-categories`
4. Run through the manual testing checklist above.
5. Commit, push.

---

## Staff Management Module (Phase: Staff/Settings, per architecture assessment ordering)

First of the two zero-schema-dependency modules from the last assessment. No Prisma changes —
`User.role`/`isActive` and the existing `staff:manage` RBAC permission already supported
everything this needed.

### 1. Files Added

- `lib/validators/staff.ts` — `createStaffSchema`, `resetPasswordSchema`
- `lib/actions/staff.ts` — `listStaff`, `createStaff`, `updateStaffRole`, `toggleStaffActive`,
  `resetStaffPassword`, `getStaffActivity`. Every mutation requires `staff:manage`
  (Super Admin only — reused the exact permission already defined in `lib/permissions.ts`, not
  a new check). Self-protection built in: a Super Admin can't demote or revoke their own
  account (would risk locking everyone out with no other Super Admin able to undo it).
- `components/admin/staff/staff-table.tsx` — main list, desktop table + mobile cards
  (matching the established pattern from Products/Inventory), inline role-change dropdown,
  revoke/reactivate toggle
- `components/admin/staff/create-staff-dialog.tsx` — add staff modal
- `components/admin/staff/reset-password-dialog.tsx` — Super-Admin-sets-new-password modal
  (not a self-service "forgot password" email flow — see Known Limitations)
- `components/admin/staff/staff-activity-dialog.tsx` — recent `ActivityLog` entries for one
  staff member, reusing the existing activity log rather than building a parallel one
- `app/admin/staff/page.tsx` — breadcrumb + page-level Super Admin check (belt-and-suspenders
  alongside the middleware fix below)

### 2. Files Modified — real, pre-existing bug fixed

- `middleware.ts` — **`SUPER_ADMIN_ONLY_PREFIXES` was checking bare `/settings` and `/staff`,
  which never matched anything** — the real pages live under `/admin/settings` and
  `/admin/staff`. This meant the Super-Admin-only route restriction silently never applied to
  the actual Staff page. Found this while building the real page and confirmed it precisely
  before fixing — not a guess. Fixed to check the real paths; simplified the route matcher
  now that everything genuinely lives under `/admin/*` (the old config had separate
  `/settings/:path*` and `/staff/:path*` matchers pointing at routes that never existed).
- `components/admin/sidebar.tsx` — Settings/Staff nav links were pointing at `/settings` and
  `/staff` (missing the `/admin` prefix every other nav item has). Fixed to `/admin/settings`
  and `/admin/staff`. This bug is also *why* the middleware gap above never surfaced before —
  the broken links meant nobody had actually navigated to a matching path yet to notice.

### 3. Files Deleted

None.

### 4. Database Changes

None.

### 5. Environment Variable Changes

None.

### 6. Dependency Changes

None — reuses `bcryptjs` (already a dependency, same hashing pattern as `auth.ts`/`seed.ts`).

### 7. Testing Checklist

**Manual tests to perform on your machine:**
1. `npm run build`
2. As Support Admin, try navigating directly to `/admin/staff` — confirm you're redirected to
   the dashboard (this is the middleware fix actually being exercised — before this fix, a
   Support Admin typing that URL in directly would **not** have been blocked)
3. As Super Admin, open Staff — create a new account, confirm it appears in the list
4. Try changing your own role away from Super Admin — confirm it's rejected
5. Try revoking your own access — confirm it's rejected
6. Create a second Super Admin (or use a test account), revoke it, confirm that account can no
   longer log in; reactivate it, confirm login works again
7. Reset a staff member's password, log out, log back in as them with the new password
8. Open "Activity" for a staff member who's made recent product/inventory changes — confirm
   those show up

**Known limitations:**
- Password reset is Super-Admin-direct-set only, not self-service "forgot password" via email.
  Resend is already wired up elsewhere in this project and could support a token-based reset
  flow later — flagging as a real future enhancement, not silently building a half version now.
- Staff activity view shows the 50 most recent entries, no pagination — fine at current volume,
  worth revisiting if staff accounts accumulate a lot of history.
- Same Prisma-generation sandbox limitation as every prior batch — clean `next lint`,
  `tsc --noEmit` at the same known count (17), nothing new.

### 8. Suggested Git Commit Messages

```
fix(middleware): correct Super-Admin-only route prefixes to match real /admin/* paths

fix(sidebar): correct Settings/Staff nav links to /admin/settings and /admin/staff

feat(staff): validators and server actions for staff management (list/create/role/access/reset/activity)

feat(staff): staff list UI with desktop table and mobile cards

feat(staff): create staff, reset password, and activity dialogs

feat(staff): Staff admin page with breadcrumb and page-level Super Admin guard
```

### 9. Documentation Updated

None this batch.

### 10. Upgrade Instructions

1. Add the 7 new files; overwrite `middleware.ts` and `components/admin/sidebar.tsx`.
2. `npm run build`
3. Run through the manual testing checklist above — **items 2 is the important one**, since
   it's confirming a real security-relevant bug fix, not just new functionality.
4. Commit, push.

---



## Milestone 1: Foundation & Auth

Delivered before this running-changelog convention started — no standalone
CHANGES.md exists for it. Summary: Next.js 15 scaffold, full initial Prisma
schema, Auth.js Credentials login, RBAC permission layer
(`lib/permissions.ts`), middleware route protection, Cloudinary/Resend
clients wired, login page, RBAC-aware dashboard shell. See `README.md` for
the original setup guide.
