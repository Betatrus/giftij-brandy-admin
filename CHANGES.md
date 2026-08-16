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
