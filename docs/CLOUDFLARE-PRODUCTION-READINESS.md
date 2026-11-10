# Cloudflare migration readiness — Admin/API

Status: **not production-ready for Cloudflare yet**. This branch is a non-production preparation branch based on `staging/preview-neon-db-routing`. No Cloudflare account resources, secrets, domains, Neon branches, Vercel settings, or live traffic are changed here.

## Verified source baseline

- Source Preview branch: `staging/preview-neon-db-routing`
- Source commit inspected: `dec285666eb2fd9b984e4a9991f19e018c840162`
- Next.js 15.5.22, React 18.3.1, Prisma Client/CLI 5.22.0, NextAuth 5.0.0-beta.25.
- The application uses App Router route handlers, server actions, Prisma, credentials-based Auth.js sessions, Paystack, Cloudinary, and Resend.
- Existing Vercel build script runs Preview migrations and integration tests only when `RUN_PREVIEW_MIGRATIONS=1`. Do not set that variable in Production or a Cloudflare Production Worker.

## Hosting approach

Use Cloudflare Workers, not Pages, for the full-stack Next.js application. Cloudflare currently documents OpenNext for maintaining Next.js 15 projects and vinext as its recommended direction for new/modernized Next.js Workers applications. For this Next.js 15 codebase, start with OpenNext as the least disruptive compatibility experiment; evaluate vinext separately only after its compatibility report and app tests are acceptable.

Do not add a speculative adapter config or upgrade Next.js/Prisma as part of a blind one-shot migration. Pin the selected adapter and Wrangler versions after the first successful clean Worker build.

## Blocking compatibility work

1. **Prisma runtime / Neon connection**
   - Current schema is Prisma 5.22.0 and `lib/prisma.ts` creates a conventional `PrismaClient` using `DATABASE_URL`.
   - The resolver uses `VERCEL_ENV` and `PREVIEW_DATABASE_URL`; these are Vercel-specific and are not a Cloudflare environment contract.
   - The current code uses the standard Prisma query-engine client. Cloudflare's current Hyperdrive Prisma examples use a driver adapter (`pg` + `@prisma/adapter-pg`) and a Worker Hyperdrive binding; current Prisma guides use newer Prisma ORM architecture. Do not assume Prisma 5.22's existing generated engine works on Workers.
   - Prove a supported adapter/version combination on a disposable Neon Preview branch. Preserve the current schema and migration history. Do not run `migrate dev`, `migrate deploy`, seed, backfill, or reset against Production.
   - Implement explicit environment resolution: local, Cloudflare Preview -> Preview Neon only, Cloudflare Production -> Production Neon only. Fail closed if a binding is missing. Keep migration credentials separate from runtime credentials.
   - Test how Prisma clients are created per Worker request/binding. Do not carry a module-global client that captures one request's environment binding.

2. **Auth.js**
   - Current Auth.js is beta.25, uses `PrismaAdapter`, credentials auth, and JWT sessions.
   - Verify login, JWT/session persistence, role claims, logout, cookie security, trusted host/URL behavior, and middleware on the actual Worker runtime.
   - Set the Cloudflare public URL explicitly and keep `AUTH_SECRET` as a Worker secret. Never reuse a Preview auth secret in Production.

3. **Paystack webhook**
   - `app/api/webhooks/paystack/route.ts` explicitly selects `runtime = "nodejs"`, imports Node `crypto`, uses HMAC SHA-512 and `timingSafeEqual`, and calls Paystack's transaction verification API.
   - Enable/test Node.js compatibility on the chosen Worker adapter. Prove the exact webhook route executes, verifies raw request bytes/signature, validates amount/currency/provider reference, and preserves idempotency under duplicate/concurrent deliveries.
   - Do not weaken payment verification or inventory transaction behavior to make the route compile.

4. **Scheduled reservation expiry**
   - The current expiry endpoint is an authenticated HTTP route using `CRON_SECRET`. Configure a Cloudflare Cron Trigger or external scheduler to call the route with its bearer secret.
   - Verify the schedule, authentication, retry behavior, and idempotent expiration against Preview only. A Worker deployment without a configured scheduler is not operationally complete.

5. **Platform and API boundaries**
   - Replace Vercel-only `VERCEL_ENV` checks with an explicit deployment-environment contract.
   - Reconcile CORS allow-lists and storefront origin with the Cloudflare Preview and eventual Production hostnames.
   - Keep `STOREFRONT_API_SECRET`, Paystack keys, Auth.js secrets, database credentials, Cloudinary credentials, Resend keys, and cron secret in Cloudflare Worker secrets. No secrets in Git, build args, public variables, or client bundles.
   - Keep the public API contract stable for the storefront. Keep Admin Preview access protected; use an appropriate Cloudflare Access policy or private Preview hostname rather than forwarding a Vercel protection-bypass header.

## Required acceptance matrix

- [ ] Clean install, Prisma generation, TypeScript check, OpenNext build, and Worker Preview boot.
- [ ] Auth login/session/role/logout and protected admin routes.
- [ ] Product and variant CRUD, inventory adjustments, reserved-stock visibility.
- [ ] Blog publishing, offer campaign/set management, and storefront public API reads.
- [ ] CORS and server-to-server storefront authentication; no secret appears in browser requests or bundles.
- [ ] Paystack Test Mode initialization, callback, raw-body signature, provider verification, amount/currency checks, duplicate webhook, and failed payment.
- [ ] 10-minute reservation lifecycle, atomic all-or-nothing stock reservation, concurrent checkout cap, no oversell, idempotent consumption/release, and late verified payment with insufficient stock.
- [ ] Cron expiry route and scheduled invocation.
- [ ] Cloudinary images, Resend email, logs/observability, rate limiting, and rollback rehearsal.
- [ ] Repeat the complete suite against the exact Worker Preview build intended for release.

## Release rules

- This branch is not a Production deployment.
- Keep Vercel Preview and Production intact during migration work.
- Keep the current Neon Production project and data unchanged.
- Do not create Cloudflare Production secrets, custom domains, DNS changes, Hyperdrive production bindings, or cut over traffic without explicit approval.
- A green GitHub check or successful compile alone is not evidence that payments, database isolation, authentication, or stock safety work in Workers.
