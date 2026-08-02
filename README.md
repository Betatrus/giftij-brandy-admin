# Giftij Brandy Admin Portal — Milestone 1: Foundation & Auth

## What's included in this milestone

- Next.js 15 App Router + TypeScript + Tailwind, design tokens matching the storefront
- PostgreSQL schema (Prisma) covering the full business domain: products, variants,
  inventory, orders, customers, communications (enquiries/complaints), campaigns,
  RBAC, and activity logging
- Auth.js (Credentials provider) with hashed passwords
- RBAC: **Super Admin** (full access) vs **Support Admin** (operational access,
  financials hidden) — enforced in `lib/permissions.ts`, `middleware.ts`, and at
  the page level, not just in the UI
- Protected `/admin`, `/settings`, `/staff` routes via middleware
- Cloudinary + Resend clients wired and ready for Milestone 2+
- Working login page and dashboard shell that already demonstrates
  role-based widget visibility

## Setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, AUTH_SECRET, etc.
npx auth secret              # generates AUTH_SECRET if you don't have one
npm run prisma:migrate       # creates all tables
npm run prisma:seed          # creates your first Super Admin login
npm run dev
```

Log in at `http://localhost:3000/login` with the email/password from
`SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` in your `.env`
(default: `bright@giftijbrandy.com` / `ChangeMe123!` — **change this password
after first login**, there's no reset flow yet).

## How the financial-data restriction actually works

This was the core requirement, so it's worth being explicit about where the
enforcement lives — three layers, not one:

1. **`lib/permissions.ts`** — `ROLE_PERMISSIONS` map + `stripFinancialFields()`.
   Any server action returning a Product, Order, or dashboard aggregate must
   call this before sending data back. It deletes `costPrice`, `profit`,
   `revenue`, `grossProfit`, `netProfit`, `profitMargin` from the payload for
   Support Admin — the fields never leave the server, so there's nothing to
   hide client-side.
2. **`middleware.ts`** — blocks Support Admin from ever loading `/settings` or
   `/staff` at the route level (redirect, not a client-side flash of content).
3. **`components/admin/sidebar.tsx`** — hides nav items for Support Admin.
   This is UX only; it is not the security boundary. Don't rely on it alone
   when building later modules.

When you build Products/Orders in Milestone 2, every server action that
touches `costPrice` or `profit` needs to call
`assertCanViewFinancials(session.user.role)` or
`stripFinancialFields(product, session.user.role)` — whichever fits the case.

## What's NOT built yet (by design — later milestones)

- Product/Inventory/Order/Customer CRUD screens (Milestone 2+)
- Public `/api/public/products` endpoint that the storefront will consume
- Paystack webhook handler
- Campaigns, email automation, analytics, reports

## Next step

Once you've confirmed login works and you're happy with the RBAC behavior
(try logging in as a Support Admin — seed one manually via Prisma Studio
with `role: SUPPORT_ADMIN` — and confirm `/settings` redirects you), say the
word and I'll start Milestone 2: Products & Inventory.

---

## Milestone 2: Products & Inventory

Adds full product management (CRUD, variants, specs, Cloudinary image
upload, homepage placement toggles) and inventory tracking (stock levels,
adjustments, low-stock flagging). See `CHANGES.md` for the full file list,
migration notes, and manual testing checklist for this milestone.

**Before running Milestone 2 locally**, since `package.json` changed:
```bash
rm -rf node_modules package-lock.json
npm install
npx prisma generate
```

New admin pages: `/admin/products`, `/admin/products/new`,
`/admin/products/[id]/edit`, `/admin/inventory`.

**RBAC in this milestone:** Support Admin can create/edit/archive products
and adjust inventory, but the Cost Price field is entirely absent from
their view of the product form and from any data the server sends them —
see `lib/permissions.ts` (`stripFinancialFields`) and
`lib/actions/products.ts` for where this is enforced.
