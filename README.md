# Giftij Brandy Admin

Giftij Brandy's internal commerce operations application and backend API. The project is a Next.js 15 App Router application written in TypeScript, using Prisma and PostgreSQL.

This README describes the current application on the `release/production-2026-11-11` branch. It replaces the original milestone-one setup notes, which no longer represented the application.

## Application responsibilities

The Admin application is the operational system of record for the Giftij Brandy storefront. Its current data model and application code cover:

- **Staff authentication and access control:** Auth.js Credentials sign-in, bcrypt password hashes, active/inactive staff accounts, and role-based access for `SUPER_ADMIN`, `TECHNICAL_SUPPORT`, and `SUPPORT_ADMIN`.
- **Catalogue:** products, categories, product specifications, product images, product lifecycle states, and product variants.
- **Inventory:** stock on hand, reserved, sold, damaged and returned quantities; separate base-product and variant inventory records; inventory adjustment history.
- **Orders and customers:** orders, order items, customer records, order notes and timeline events, and customer activity.
- **Checkout and payment processing:** Paystack webhook handling, payment verification, checkout reservations, stock allocation, and order creation.
- **Returns and refunds:** customer return records, restock quantities, refund amounts and refund status.
- **Customer communications:** enquiries, complaints, assignment, replies and ticket statuses.
- **Marketing:** email campaign records, offer campaigns, offer sets and product-level offer rules.
- **Editorial CMS:** blog posts, categories, publication scheduling, SEO metadata, indexing controls and old-slug redirects.
- **Store settings and auditability:** customer-care WhatsApp settings, activity logs and operational event history.

The Prisma schema is the authoritative description of persisted data. Actual permissions and business rules are enforced in server-side application code; hiding a control in the interface is not a security boundary.

## Technology

- Next.js 15 App Router
- React 18 and TypeScript
- Auth.js (NextAuth v5 beta) with Credentials provider and Prisma adapter
- PostgreSQL with Prisma ORM 5
- Tailwind CSS
- Cloudinary for product/editorial image assets
- Paystack for payment processing
- Resend for transactional/email delivery integration
- Vercel deployment support

## Local development

### Requirements

- Node.js compatible with the Next.js version in `package.json`
- npm
- A PostgreSQL database
- Cloudinary credentials for image upload features
- Paystack and Resend credentials for the related integrations

### Install

```bash
npm install
cp .env.example .env
```

Fill in the local environment values described below. Then generate the Prisma client and start the development server:

```bash
npx prisma generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Do not point local development at the live Production database unless a task explicitly requires it and the owner has approved that access. Prefer a disposable local database or the isolated Preview database.

## Environment variables

Use the repository's `.env.example` as the current variable-name reference. Values must be configured in the relevant deployment environment; never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection (normally pooled for Neon). |
| `DIRECT_URL` | Direct PostgreSQL connection used by Prisma migration tooling. |
| `PREVIEW_DATABASE_URL` | Preview-only database connection used by the Preview database-routing safeguards. Do not set this to Production. |
| `AUTH_SECRET` | Auth.js signing/encryption secret. Generate with `npx auth secret`. |
| `AUTH_URL` | Canonical Admin application URL for the environment, where required by the deployment. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name. |
| `CLOUDINARY_API_KEY` | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret. |
| `RESEND_API_KEY` | Resend API key. |
| `RESEND_FROM_ADDRESS` | Verified sender address for email. |
| `CRON_SECRET` | Bearer-token secret protecting scheduled reservation-expiry work. |
| `PAYSTACK_SECRET_KEY` | Server-side Paystack secret used for payment verification and related API calls. Never expose it to the browser. |
| `STOREFRONT_URL` | Storefront base URL used when constructing payment callback URLs. |
| `CUSTOMER_CARE_WHATSAPP` | Optional international-format customer-care number. |
| `PUBLIC_API_ALLOWED_ORIGINS` | Comma-separated CORS allow-list for public API requests. |
| `SEED_SUPER_ADMIN_EMAIL` | Optional email for the initial Super Admin seed. |
| `SEED_SUPER_ADMIN_PASSWORD` | Optional password for the initial Super Admin seed. |

Use separate credentials and values for Preview and Production. Never copy a Production database URL or live Paystack secret into Preview. Do not paste secrets into issues, pull requests, chat, logs or this README.

## Database and Prisma

The Prisma schema is in `prisma/schema.prisma`; migration history is in `prisma/migrations/`.

Useful commands:

```bash
npx prisma generate
npx prisma migrate status
npx prisma studio
```

For a new disposable development database only, apply migrations with:

```bash
npx prisma migrate deploy
```

**Production database changes require an explicit migration plan and approval.** Do not run `prisma migrate dev`, `prisma db push`, reset commands, seed scripts or migration deployment against Production as an incidental part of a Vercel deployment. Review migration history and the target database first, take an appropriate backup, and use the approved release procedure.

### Migration reconciliation note

The Production database's recorded Prisma history includes the legacy migration `20261029172544_add_order_number_counter`, while its original migration source file was not present on this release branch during the November 2026 release review. Do not recreate, delete, mark rolled back, or otherwise alter historical migration records by guesswork. Reconcile this discrepancy deliberately before claiming that a fresh Prisma migration-status comparison is fully clean.

## Vercel build and Preview safeguards

The configured Vercel build command is:

```bash
sh scripts/vercel-build.sh
```

The script always runs the application build. It only applies Prisma migrations and runs the Preview verification/integration scripts when `RUN_PREVIEW_MIGRATIONS=1` **and** `VERCEL_ENV=preview`. It exits with an error if that flag is enabled outside a Preview deployment.

This guard is a safety check, not a substitute for verifying environment-variable scopes. Keep Preview database credentials and migration flags scoped to Preview. Production must use its approved database and release process; do not enable Preview migration settings for Production.

Before deploying a new Vercel project:

1. Connect the intended repository and select `release/production-2026-11-11` as the Production Branch.
2. Configure the required environment variables for the intended environment. Check every database URL and secret scope carefully.
3. Confirm the deployment's build command is `sh scripts/vercel-build.sh`.
4. Deploy and inspect the build logs and resulting deployment status.
5. Verify the Admin application, authentication, database-backed pages and required API endpoints using the deployment URL.
6. Confirm the Storefront points to the intended Admin API deployment before changing any public domain or webhook configuration.

A green Vercel **Ready** status means the deployment completed; it does not by itself prove database connectivity, correct credentials, successful authentication, webhook delivery, scheduled jobs or end-to-end checkout.

## Payment and inventory safety

Payment and stock behavior is business-critical. Preserve these invariants when changing this code:

- A browser redirect or client-side success message is not proof of payment.
- Verify Paystack webhook signatures server-side and verify the transaction with Paystack before treating a payment as successful.
- Check the transaction reference, status, amount and currency against the server-calculated checkout.
- Process duplicate webhook deliveries idempotently; one successful payment must not create duplicate orders or consume stock twice.
- Failed, abandoned or incomplete payments must not deduct stock.
- Reserve the full requested quantity atomically or reject the reservation; do not partially reserve or oversell.
- Consume a valid reservation only after verified payment. Release expired/failed reservations according to the approved payment-status procedure.
- If payment succeeds after the reservation expires and stock is no longer available, record the stock-unavailable review state for an administrator. Never create negative stock.
- Keep payment secrets server-side and keep Preview/Test payment configuration separate from Production/Live configuration.

Do not weaken these safeguards to make a deployment or manual test pass.

## Scheduled reservation expiry

Reservation expiry is a server-side scheduled operation protected by `CRON_SECRET`. Configure the scheduler and endpoint for each environment deliberately, with environment-specific URLs and secrets. Confirm the scheduler is enabled and inspect its execution logs; a successful application deployment does not automatically prove that a scheduled job is running.

## Initial staff provisioning

The seed script is `prisma/seed.ts`; run it only as part of an explicitly approved first-time provisioning process against the intended database. It creates a Super Admin only if the configured email does not already exist.

```bash
npm run prisma:seed
```

The seed script has a fallback password for local development. Set a strong, unique `SEED_SUPER_ADMIN_PASSWORD` before any approved use, never rely on the fallback for a real account, and change the credential through the approved account-management process. Do not run the seed casually against an existing Production database.

## Package scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server. |
| `npm run build` | Build the Next.js application. |
| `npm run start` | Start the built application. |
| `npm run prisma:generate` | Generate the Prisma client. |
| `npm run prisma:migrate` | Run Prisma's development migration command; use only with a disposable development database. |
| `npm run prisma:studio` | Open Prisma Studio. |
| `npm run prisma:seed` | Run the initial Super Admin seed; requires explicit approval and the correct database. |

## Release checklist

- [ ] Confirm the exact branch and commit being deployed.
- [ ] Confirm the Production and Preview environment-variable scopes.
- [ ] Confirm the Admin runtime database points to the intended existing database.
- [ ] Confirm the Preview database is isolated and Preview-only.
- [ ] Review Prisma migration status and resolve known historical discrepancies safely.
- [ ] Confirm the Vercel build succeeds without unintended migration execution.
- [ ] Confirm Admin login and role-based access.
- [ ] Confirm product, inventory, order and customer data load correctly.
- [ ] Confirm product image upload and retrieval through the configured Cloudinary account.
- [ ] Confirm the public Storefront API responds from the intended deployment and the Storefront can load product data.
- [ ] Confirm Paystack webhook configuration and delivery using the appropriate Test/Live environment without mixing credentials.
- [ ] Confirm reservation expiry scheduling and logs.
- [ ] Run the approved payment, reservation, idempotency and inventory tests before routing live traffic.
- [ ] Only after successful validation, plan any domain or webhook cutover separately.

## Operational boundaries

- Keep the existing Production database and customer data intact during hosting migration.
- Do not change DNS, the live Paystack webhook, or customer-facing Production routing as part of a Preview test.
- Do not run database migrations or seed scripts just because a new Vercel project has been created.
- Preserve the current storefront design and customer checkout experience unless a separately approved task requires a change.
- Treat the Google Cloud deployment as a separately validated backup target; it must not share or mutate Production resources until its configuration and recovery procedure have been reviewed.

## Repository

- GitHub: [Betatrus/giftij-brandy-admin](https://github.com/Betatrus/giftij-brandy-admin)
- Release branch: [release/production-2026-11-11](https://github.com/Betatrus/giftij-brandy-admin/tree/release/production-2026-11-11)
