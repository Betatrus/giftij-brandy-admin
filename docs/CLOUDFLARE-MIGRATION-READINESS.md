# Giftij Brandy — Cloudflare migration readiness

Status: preparation only. No Cloudflare resources, domains, production deployments, or live traffic have been changed.

## Target architecture

- GitHub remains the source of truth and CI/deployment trigger.
- Cloudflare Workers hosts two separate applications: storefront and admin/API.
- Neon remains the PostgreSQL system of record. Do not migrate database ownership or data to Cloudflare.
- Paystack remains the payment processor.
- Cloudinary remains the product/blog image service for now; Resend remains the email provider.
- Cloudflare DNS/CDN/WAF can be introduced during the controlled cutover. R2 is optional and is not required for the initial migration.

## Repository release candidates

- Admin: `staging/preview-neon-db-routing`
- Storefront: `staging/checkout-10-minute-reservation`

Do not use the older admin implementation branch as the release candidate. Do not merge to a production branch or switch domains as part of preparation.

## Findings from the staging code

### Admin

- Next.js 15.5.22, React 18.3.1, Prisma Client 5.22.0, NextAuth v5 beta.
- PostgreSQL schema uses `DATABASE_URL` at runtime and `DIRECT_URL` for Prisma migrations.
- Runtime DB selection currently depends on Vercel's `VERCEL_ENV` and `PREVIEW_DATABASE_URL`; Cloudflare needs an explicit environment/binding-based Preview-vs-production selection. Never silently fall back from Preview to production.
- Paystack webhook explicitly declares `runtime = "nodejs"` and imports Node crypto. This requires Workers Node compatibility and end-to-end webhook verification in the target adapter.
- Cloudinary and Resend credentials are server-side secrets and must be configured separately for each Worker environment.
- Existing Vercel-specific environment assumptions must be removed or isolated behind a platform-neutral environment resolver before cutover.

### Storefront

- Next.js 16.2.6.
- Storefront calls the admin API using `NEXT_PUBLIC_GIFTIJ_API_BASE` in the browser and `GIFTIJ_API_BASE` / `STOREFRONT_API_SECRET` for server-side catalogue requests.
- Preserve the existing API contract and customer-facing design. The public API hostname and CORS allow-list need to be mapped to the Cloudflare Worker routes without exposing the storefront secret.
- `next.config.mjs` currently disables Next image optimization; verify remote image delivery after adapter migration.

## Adapter decision — do not assume one adapter fits both

- Storefront (Next.js 16): run `npx vinext check` first. If the compatibility report is clean enough, add vinext non-destructively and test it on a separate Worker Preview. If not, evaluate OpenNext.
- Admin (Next.js 15): do not run a Next.js 16-only vinext setup blindly. Evaluate the Cloudflare OpenNext adapter first, then test the actual Auth.js, Prisma, webhook, Node crypto and server-action paths.
- Keep the original Next.js/Vercel build scripts working during the compatibility phase.
- Do not deploy either Worker to a production custom domain until the complete test matrix passes.

## Neon connection plan

Keep Neon as the database. Evaluate Cloudflare Hyperdrive in front of the existing Neon PostgreSQL database to pool connections and reduce connection setup latency. Use separate Hyperdrive configurations for Preview and Production, each pointing to the matching Neon branch. Keep migration credentials separate from runtime credentials.

Before adopting Hyperdrive, prove compatibility with the pinned Prisma 5.22 client and the chosen Next.js adapter. Do not change the Prisma version or schema as part of an unverified hosting migration. Never run migrations against Production during preparation.

## Required Worker environment variables

Configure values in Cloudflare Worker secrets/vars, never in Git:

- Admin runtime: database connection binding/URL, `AUTH_SECRET`, `AUTH_URL` (if required by Auth.js), `PAYSTACK_SECRET_KEY`, `STOREFRONT_URL`, `STOREFRONT_API_SECRET` (if consumed by admin routes), `PUBLIC_API_ALLOWED_ORIGINS`, `CRON_SECRET`, Cloudinary credentials, Resend credentials, customer-care configuration.
- Storefront runtime: `GIFTIJ_API_BASE`, `STOREFRONT_API_SECRET`, and any public `NEXT_PUBLIC_GIFTIJ_API_BASE` value required at build time.
- Keep Test Paystack credentials and Preview Neon connections separate from Live Paystack credentials and Production Neon connections.
- Do not copy the current `SEED_SUPER_ADMIN_PASSWORD` example into a deployed environment.

Exact variable names and bindings must be reconciled against runtime code before configuration; this list is an inventory, not an instruction to set every variable in both apps.

## Acceptance tests before cutover

1. Build and boot both Worker Preview deployments.
2. Admin login, session persistence, role-based access and logout.
3. Product, variant, image, blog and offer/campaign admin workflows.
4. Public catalogue reads, CORS, rate limits and storefront-to-admin API connectivity.
5. Paystack Test Mode: initialization, callback, signed webhook, provider-side verification, amount/currency checks, duplicate delivery and failed payment.
6. Reservation expiry, idempotent release, concurrent checkout cap, no overselling, successful payment consumption, and late verified payment with no stock.
7. Email delivery and Cloudinary image delivery.
8. Preview cron authentication and scheduled expiry execution.
9. Observability, error reporting, rollback path and DNS TTL/cutover plan.

## Current blockers / work still required

- Run actual adapter compatibility checks in both repositories; source inspection alone cannot establish a successful Worker build.
- Resolve the admin Prisma/Hyperdrive/Node compatibility path with a disposable Neon Preview branch.
- Validate Auth.js session behavior and Paystack webhook behavior on Workers.
- Fix and run the Preview integration suite only after reviewing its cleanup boundaries. It must not alter pre-existing store settings or delete unrelated audit logs.
- The admin navigation currently exposes Blog Management as a separate item. The requested Marketing landing/grouping and a complete Offer Campaign management workflow still need implementation. The current Prisma `Campaign` model represents email campaigns; it is not evidence that offer campaigns are implemented.
- No Cloudflare account ID, Worker resources, secrets, domains, or production cutover are assumed by this document.

## Safe execution order

1. Finish admin Marketing/Offer Campaign scope and test-harness safety.
2. Run existing Vercel Preview integration tests against isolated Neon Preview.
3. Run adapter checks and prepare non-production Worker configurations.
4. Deploy Worker Preview only and repeat the full acceptance matrix.
5. Obtain explicit approval before any Production resources, DNS, domains, secrets, database migration, or traffic cutover are changed.
