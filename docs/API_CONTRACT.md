# Giftij Brandy — API Contract & Specification
## v1.0 — Living document. This is the permanent source of truth for the API surface.

This document grows with each milestone. It currently covers **Milestone 3 scope only:
read-only product catalog endpoints.** Checkout, cart validation, and payment
integration were deliberately moved to Milestone 4 (your call — smaller blast radius,
storefront proven against live data before payment complexity enters) and will be
appended to this same document, not written as a separate one.

The contract is designed **around the Prisma schema**, not around any storefront mock
data. Where the existing storefront needs a different shape, that's handled by an
adapter layer on the storefront side (see `docs/MILESTONE_3_API_ARCHITECTURE.md` §"Product
Response Shape" discussion) — this document stays the clean, canonical contract.

---

## Conventions (apply to every endpoint below)

**Base URLs**
| Environment | Base URL |
|---|---|
| Production | `https://api.giftij.com/api/v1/public` |
| Preview/staging | `https://<preview-deployment>.vercel.app/api/v1/public` |
| Local dev | `http://localhost:3000/api/v1/public` |

**Headers**
- `Content-Type: application/json` required on all POST bodies (none in Milestone 3 scope, added in Milestone 4)
- `Accept: application/json`
- No auth header on any endpoint in this document — all public, CORS-gated (see below)

**CORS**
Allowed origins: `https://www.giftij.com`, `https://giftij.com`, plus preview storefront
URLs added as needed. Requests from any other origin are rejected at the CORS layer
before reaching route logic.

**Envelope — every response follows one of these two shapes, no exceptions**

Success:
```json
{
  "success": true,
  "data": {},
  "meta": { "page": 1, "pageSize": 20, "total": 137, "pageCount": 7 }
}
```
`meta` is present only on list endpoints.

Error:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```
`details` is optional and only included where it adds actionable information (e.g. which
field failed validation).

**Standard error codes (Milestone 3 scope)**

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request query/body failed Zod validation |
| `NOT_FOUND` | 404 | Resource doesn't exist, or exists but isn't publicly visible (e.g. a DRAFT product) |
| `RATE_LIMITED` | 429 | Too many requests from this client in the current window |
| `INTERNAL_ERROR` | 500 | Unexpected server error — logged server-side, generic message returned to client |

**Rate limits (Milestone 3 scope — read-only endpoints)**
120 requests/minute per IP across `/api/v1/public/*`. Generous for normal storefront
browsing; tightened per-endpoint in Milestone 4 for write endpoints (checkout, enquiries).

**Field visibility guarantee**
`costPrice`, `profit`, and any other financial field are never selected by any query
backing a public endpoint. This isn't enforced by stripping fields after the fact — the
Prisma `select` clause for public endpoints simply never includes them. There is no code
path by which they could leak here.

---

## Storefront Adapter & Mock-Data Independence

This section is now concrete, having seen the actual `products-data.js` /
`product-render.js` (previously theoretical). Confirms the principle from
Milestone 3 approval: **the API is shaped by the Prisma schema, never by the
mock data.** Every place the mock shape differs from the API shape below is
handled by one adapter function on the storefront side, not by bending the
API.

**Where the shapes genuinely differ, and how the adapter bridges each:**

| Mock field | API equivalent | Adapter behavior |
|---|---|---|
| `id` (e.g. `"the-empress-tote"`, used as a slug) | `slug` | Direct passthrough — `slug` was designed for exactly this |
| `images: string[]` — **raw inline `<svg>...</svg>` markup**, injected via `frame.innerHTML = p.images[0]` | `images: [{ url, altText, ... }]` — real Cloudinary URLs | Adapter wraps each URL as an `<img src="..." alt="...">` string so the existing `innerHTML` injection in `gbRenderCard` keeps working unchanged. This is the one piece of real "translation," not just renaming — flagging clearly since it's the highest-risk part of the cutover to get right in testing |
| `material: "Full-Grain Leather · Camel"` (combined material+color display string) | not a direct field — derived from `specs` + variant `value` | Adapter builds this from `specs.find(s => s.label === 'Material')?.value` joined with the first variant's `value` **only when `variantType === "Colour"`** (for a `"Size"`-typed product, joining the size onto "material" would be nonsensical — the adapter checks `variantType` before deciding whether to include the variant value here at all). Falls back to just the material spec otherwise. **Admin workflow note:** for this to work cleanly, product entry should include a spec labeled exactly `"Material"` |
| `badge: "Best Seller" \| "New" \| "Sale" \| "Fan Fave" \| null` | *(not an API field — deliberately excluded, see next section)* | Adapter derives it from `featuredFlags` + `discount` |
| `oldPrice: number \| null` (absolute former price) | `discount: number` (percentage) | Adapter computes `oldPrice = discount > 0 ? price : null` and the displayed `price = discount > 0 ? round(price * (1 - discount/100)) : price` — see "Discount Semantics" below |
| `category: "rough-body"` (flat string, one per product) | `categories: [{ name, slug }]` (array — a product can belong to multiple categories) | Adapter reads `categories[0]?.slug` for the mock's single-category `data-cat` attribute, since the current storefront filter UI only supports one active category at a time. This is a deliberate simplification on the adapter side, not a data-loss issue — the API still returns every category the product belongs to |
| `featured: boolean` | `featuredFlags: string[]` | Adapter: `featured = featuredFlags.length > 0` |
| *(none — mock has no equivalent)* | `variantType: string \| null` (e.g. `"Colour"`, `"Size"`, or an admin-defined custom label) | New in the API detail response. Tells the adapter/storefront what a variant's `value` field means, and (per the rule above) whether it's meaningful to fold into the `material` display string |

**Not carried forward at all:** the mock's placeholder SVGs are test fixtures only, not a
real product photography strategy — real products get real Cloudinary photos from
day one via the admin uploader (Milestone 2, already built).



## Admin-Managed Featured Collections & Badge Derivation

**Architecture decision:** which products appear as "Best Seller," "New," "Fan Fave," etc.
on the storefront is controlled entirely by the admin toggling `featuredFlags` in the
dashboard (built in Milestone 2 — see `components/admin/products/featured-toggles.tsx`).
Nothing about badges is hardcoded in the API or the storefront.

The API returns the raw `featuredFlags` array — clean, multi-value, matching the schema.
It deliberately does **not** return a single `badge` string, because the mock's
single-badge-per-product model is a display simplification that shouldn't leak into the
data contract (a product can legitimately be both `best_sellers` and `new_arrivals` at
once; the API shouldn't have to pick one).

The storefront adapter derives the single display badge with this priority order
(highest wins, matching the mock's `gbBadgeClass()` keyword logic):

1. **"Sale"** — if `discount > 0` (price-driven, not an admin flag)
2. **"Best Seller"** — if `featuredFlags` includes `best_sellers`
3. **"New"** — if `featuredFlags` includes `new_arrivals`
4. **"Fan Fave"** — if `featuredFlags` includes `fan_favorites`
5. else `null` — no badge rendered, exactly like today for un-flagged products

This priority order is a product decision as much as a technical one — flag me if you'd
rather a flagged collection outrank an active discount, or want badge priority
configurable in Settings later rather than fixed in the adapter.

## Discount Semantics

`Product.price` is always the **full retail price**. `Product.discount` is a percentage,
`0` when not on sale. Neither the API nor the database stores a pre-computed "sale
price" — it's derived wherever it's needed:

```
displayPrice = discount > 0 ? round(price * (1 - discount / 100)) : price
oldPrice     = discount > 0 ? price : null   // adapter-only concept, not an API field
```

This same formula is what Milestone 4's checkout will charge — documenting it now so
it's decided once, not reinvented per milestone.

## Image Strategy

Real products are photographed and uploaded through the admin panel only (Cloudinary,
Milestone 2 — customers/storefront never upload images). Two things follow from that:

**Image metadata expansion (Batch 1 schema addition):** `ProductImage` gains `altText`,
`width`, `height`, and `format` fields, populated automatically from Cloudinary's upload
response (it already returns width/height/format for every upload — `lib/cloudinary.ts`'s
`uploadImage()` just needs to capture and store them instead of discarding them). This
enables proper `<img>` attributes (avoiding layout shift) and is a prerequisite for any
future responsive-image work.

**Cloudinary delivery optimization:** product image URLs returned by the API should use
Cloudinary's automatic format/quality transformation (`f_auto,q_auto` in the delivery
URL) so each browser gets the smallest suitable format (WebP/AVIF where supported)
without the API needing to know anything about the requesting client. This is a URL
convention applied when images are uploaded/stored, not a per-request computation.

**Adapter responsibility (see table above):** since the mock's render logic injects
`p.images[0]` directly as `innerHTML`, and a Cloudinary URL is not valid HTML on its own,
the adapter wraps every URL as `<img src="..." alt="..." loading="lazy">` before handing
it to `gbRenderCard`. This is the highest-risk translation in the whole cutover and gets
explicit manual testing in Batch 2, not just a glance.

## Search Behavior

The `q` parameter matches (case-insensitive) against `Product.name`, `Product.sku`,
`Product.shortDesc`, and `Product.tags` (array-contains) — broader than originally
scoped to name/SKU only, since tag and short-description matches are meaningfully useful
for customers searching e.g. "leather" or "crossbody" and cost nothing extra at this
data size (thousands of rows, not millions — a straightforward indexed `ILIKE`/array
query is fine; no need for a dedicated search engine at MVP scale).

## Future Extensions (not built now, architecture doesn't block them)

- **Related products** — a `GET /products/:slug/related` endpoint (or a `related` array
  on the detail response) is a natural Milestone 5+ addition once there's enough catalog
  data for "same category, different product" or tag-overlap logic to be meaningful. Not
  worth building against 15 seed products.
- **Mobile app / vendor portal / marketplace APIs** — nothing above assumes a single
  consumer. `/api/v1/public/*` is browser-facing by convention (CORS-gated), not by
  technical restriction; a mobile app could consume the identical endpoints directly
  (no CORS concern from a native app), and the reserved `/api/v1/admin/*` namespace is
  exactly where a future vendor portal would plug in without touching this contract.

---

## Data Model Reference (as of the pre-launch schema finalization)

**`Category` — many-to-many with `Product`**
```prisma
model Category {
  id          String     @id @default(cuid())
  name        String
  slug        String     @unique
  description String?
  image       String?
  parentId    String?
  parent      Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children    Category[] @relation("CategoryHierarchy")
  isActive    Boolean    @default(true)
  sortOrder   Int        @default(0)
  products    Product[]  // implicit many-to-many — a product can belong to several categories
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}
```
A product belongs to as many categories as the admin selects (e.g. a tote can be in
"Totes", "New Arrivals", and "Office Collection" at once) — this replaced an earlier
single-`categoryId` design before any production data existed. `parentId` still supports
subcategories via self-relation.

**`Category` response — `productCount`:** the API's `Category` response (§Endpoint 3)
includes a `productCount` field — the number of `ACTIVE` products in that category. This
is a computed value (`Prisma`'s `_count` relation aggregate, which works the same way
across a many-to-many relation as it did across the earlier one-to-many design), not a
stored column.

**`ProductImage` — modified**
- `+ altText` — `String?`, admin-editable, falls back to the product name if blank
- `+ width`, `+ height` — `Int?`, captured automatically from Cloudinary's upload response
- `+ format` — `String?`, e.g. `"webp"`, also from Cloudinary's response
- `+ imageType` — `COVER` \| `GALLERY` \| `VARIANT`
- `variantId` is now `@unique` — a variant has **at most one** image, DB-enforced, not
  just an app-layer convention

**`Product` — modified**
- `+ slug` — `String @unique`, auto-generated from `name` on create, editable afterward
- `categories` — many-to-many, see above (replaces an earlier `categoryId` design)
- `+ variantType` — `String?`, **admin-defined, not an enum**. The admin picks a preset
  ("Colour", "Size", "Material") or types a custom value when they choose "Other" — the
  database just stores whatever string results. This is what makes adding a brand-new
  variant dimension later (e.g. footwear sizing) a zero-migration change: it's a new
  string value, never a new column or enum member. `null` when the product has no
  variants.

**`ProductVariant` — modified**
- Fixed `color`/`size`/`material`/`pattern` columns **removed**, replaced by a single
  `value: String` field. What `value` *means* is given by the parent Product's
  `variantType` — one flexible column instead of one column per possible attribute.
- `price` field **removed entirely** — confirmed business rule: every variant of a
  product shares the base `Product.price`. There is no per-variant price override.
- `+ currentStock`, `reservedStock`, `soldStock`, `damagedStock`, `returnedStock`,
  `lowStockThreshold` — each variant tracks its own stock independently (mirroring the
  base `Inventory` model's fields exactly), with its own `VariantInventoryLog` audit
  trail. A product either has variants (stock lives per-variant) or doesn't (stock lives
  on the base `Inventory` row) — never both at once.
- One variant type per product for MVP (no Colour+Size combinations yet) — enforced by
  `variantType` being a single field, not an array.

---

## Endpoint 1 — List Products

**`GET /api/v1/public/products`**

Returns paginated, filterable product listings for the storefront's shop/grid/carousel
views.

### Query Parameters

| Param | Type | Required | Notes |
|---|---|---|---|
| `q` | string | no | Free-text search — matches name, SKU, short description, and tags (see §Search Behavior), max 100 chars |
| `category` | string | no | Category **slug** (not name) |
| `featured` | string | no | One of: `hero`, `best_sellers`, `fan_favorites`, `new_arrivals`, `trending`, `luxury_collection`, `recommended`, `limited_edition`, `recently_added` |
| `sort` | string | no | One of: `newest` (default), `price_asc`, `price_desc`, `name_asc` |
| `page` | integer | no | Default `1`, min `1` |
| `pageSize` | integer | no | Default `20`, min `1`, max `50` |

Only `status: ACTIVE` products are ever returned by this endpoint — DRAFT and ARCHIVED
are invisible to the public API regardless of query params.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "clx4a9f2k0001",
      "slug": "the-adaeze-tote",
      "name": "The Adaeze Tote",
      "shortDesc": "Structured everyday luxury in genuine leather.",
      "categories": [{ "name": "Totes", "slug": "totes" }, { "name": "New Arrivals", "slug": "new-arrivals" }],
      "price": 185000,
      "discount": 10,
      "currency": "NGN",
      "coverImage": "https://res.cloudinary.com/giftij/image/upload/v1/products/adaeze-1.jpg",
      "images": [
        "https://res.cloudinary.com/giftij/image/upload/v1/products/adaeze-1.jpg",
        "https://res.cloudinary.com/giftij/image/upload/v1/products/adaeze-2.jpg"
      ],
      "featuredFlags": ["best_sellers", "new_arrivals"],
      "inStock": true,
      "hasVariants": true
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 137, "pageCount": 7 }
}
```

### Error Responses

| Case | Response |
|---|---|
| `pageSize` > 50 | `400 VALIDATION_ERROR` — `"pageSize must be between 1 and 50"` |
| Invalid `sort` value | `400 VALIDATION_ERROR` — `"sort must be one of: newest, price_asc, price_desc, name_asc"` |
| Unknown `category` slug | **Not an error** — returns `200` with an empty `data` array, since "no products in this category" is a valid, expected state, not a client mistake |

### Authentication
None. Public, CORS-gated, rate-limited.

### Example
```
GET /api/v1/public/products?category=totes&featured=best_sellers&sort=price_asc&page=1&pageSize=12
```

---

## Endpoint 2 — Get Single Product

**`GET /api/v1/public/products/:slug`**

Full product detail for a single product page — includes variants, specs, and the full
image set (list endpoint only returns `coverImage` + a light `images` array; this
endpoint is the complete record).

### Path Parameters
| Param | Type | Notes |
|---|---|---|
| `slug` | string | The product's unique slug |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "clx4a9f2k0001",
    "slug": "the-adaeze-tote",
    "name": "The Adaeze Tote",
    "shortDesc": "Structured everyday luxury in genuine leather.",
    "fullDesc": "Hand-finished in full-grain leather, The Adaeze Tote pairs a structured silhouette with soft, supple handles built for daily wear...",
    "categories": [{ "name": "Totes", "slug": "totes" }],
    "brand": "Giftij Brandy",
    "price": 185000,
    "discount": 10,
    "currency": "NGN",
    "weight": 1.2,
    "dimensions": "34cm x 26cm x 12cm",
    "warranty": "6 months",
    "tags": ["leather", "everyday", "structured"],
    "featuredFlags": ["best_sellers", "new_arrivals"],
    "images": [
      { "url": "https://res.cloudinary.com/.../adaeze-1.jpg", "altText": "The Adaeze Tote, front view", "width": 1200, "height": 1500, "format": "webp", "sortOrder": 0 },
      { "url": "https://res.cloudinary.com/.../adaeze-2.jpg", "altText": "The Adaeze Tote, interior", "width": 1200, "height": 1500, "format": "webp", "sortOrder": 1 }
    ],
    "specs": [
      { "label": "Material", "value": "Genuine full-grain leather" },
      { "label": "Lining", "value": "Cotton twill" }
    ],
    "variantType": "Colour",
    "variants": [
      { "sku": "GB-TOTE-BLK", "value": "Black", "inStock": true, "image": "https://res.cloudinary.com/.../adaeze-blk-1.jpg" },
      { "sku": "GB-TOTE-TAN", "value": "Tan", "inStock": false, "image": "https://res.cloudinary.com/.../adaeze-tan-1.jpg" }
    ],
    "inStock": true,
    "seoTitle": "The Adaeze Tote — Giftij Brandy",
    "seoDescription": "Structured everyday luxury in genuine leather, hand-finished."
  }
}
```

Notes on this shape:
- All variants share the product-level `price`/`discount` — there is no per-variant price
- `variantType` tells the storefront what `variants[].value` means for this product
  (`"Colour"`, `"Size"`, or any admin-defined custom label) — `null` when the product has
  no variants
- `variants[].image` is a single URL or `null` (a variant has at most one image, DB-enforced)
- `variants[].inStock` is derived (`currentStock > 0`), not a raw DB field — the API never
  exposes raw stock counts publicly (that's an inventory management detail, not a
  storefront concern; "in stock" / "out of stock" is all a customer needs)
- `inStock` at the product level is `true` if the base product OR any variant has stock

### Error Responses

| Case | Response |
|---|---|
| No product with this slug | `404 NOT_FOUND` — `"Product not found"` |
| Product exists but is DRAFT/ARCHIVED | `404 NOT_FOUND` — identical response to "doesn't exist," deliberately — the public API never reveals that a non-public product exists |

### Authentication
None.

### Example
```
GET /api/v1/public/products/the-adaeze-tote
```

---

## Endpoint 3 — List Categories

**`GET /api/v1/public/categories`**

Returns the active category tree for navigation and filter UI.

### Query Parameters
| Param | Type | Required | Notes |
|---|---|---|---|
| `flat` | boolean | no | Default `false`. If `true`, returns a flat list instead of nested tree (useful for simple dropdown filters) |

### Success Response — `200 OK` (default, nested)

```json
{
  "success": true,
  "data": [
    {
      "name": "Bags",
      "slug": "bags",
      "image": "https://res.cloudinary.com/.../bags-cover.jpg",
      "productCount": 42,
      "children": [
        { "name": "Totes", "slug": "totes", "image": null, "productCount": 12, "children": [] },
        { "name": "Clutches", "slug": "clutches", "image": null, "productCount": 8, "children": [] }
      ]
    }
  ]
}
```

Only `isActive: true` categories are returned. `sortOrder` determines array order at
every level.

### Error Responses
None specific to this endpoint beyond the generic `500 INTERNAL_ERROR` fallback — there's
no user input that can produce a validation error here beyond the `flat` boolean itself.

### Authentication
None.

---

## Change Log

| Date | Change |
|---|---|
| This milestone | Initial version — Endpoints 1–3 (products list, product detail, categories) |

Milestone 4 will append a Checkout & Orders section to this same document (`POST
/cart/validate`, `POST /checkout`, webhook contract) rather than starting a new file.
