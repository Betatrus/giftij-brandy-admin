# Giftij Brandy Admin — Cloudflare Preview setup

This branch is the Cloudflare migration Preview branch. Do not merge it into `main` or use Production credentials until Preview testing is complete.

## Workers Builds

Configure the Admin Worker build settings:

- Production branch: `main`
- Build command: `npm run cloudflare:build`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler preview`
- Root directory: `/`
- Build variable: `SKIP_DEPENDENCY_INSTALL=1` (the build script runs `npm install` itself to synchronize the lockfile before OpenNext builds)

The Preview command must use Cloudflare Worker Previews, not `wrangler versions upload`. Worker Previews use the `previews` block in `wrangler.jsonc` and do not inherit Production bindings.

## Database isolation

`wrangler.jsonc` intentionally contains two visibly named placeholders:

- `REPLACE_WITH_PREVIEW_HYPERDRIVE_ID`: replace with a Hyperdrive configuration connected only to Neon Preview.
- `REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID`: leave untouched until the Production migration stage.

The application uses the `HYPERDRIVE` binding through a request-scoped Prisma 5.22 driver adapter. A missing Worker binding fails closed; it will not fall back to a direct `DATABASE_URL`. Local Node development continues to use `DATABASE_URL`.

Do not place database passwords or connection strings in this file. Keep them inside the Hyperdrive configuration and Cloudflare secrets.

## Preview secrets

Copy the application's existing required environment variables into the Worker Preview secrets using the exact names already used by the application. Use only Paystack Test credentials and Preview-only third-party credentials. Do not copy Production secrets into Preview.

The Preview Admin account is provisioned using the existing guarded seed script, only after the Preview Worker starts and the Neon Preview schema is ready:

```sh
SEED_TARGET=preview
SEED_PREVIEW_DATABASE_CONFIRMATION=giftij-brandy-preview-test
PREVIEW_DATABASE_URL=<Neon Preview direct connection>
SEED_SUPER_ADMIN_PASSWORD=<one-time strong password>
npm run prisma:seed-preview-admin
```

The script refuses to run without explicit Preview confirmation, never falls back to `DATABASE_URL`, and does not reset an existing password.

## Cloudflare Preview acceptance checks

1. Confirm the Admin Worker Preview loads and login routes render.
2. Confirm Prisma connects through the Preview Hyperdrive binding.
3. Provision the Preview Super Admin with the guarded seed script.
4. Test login, role restrictions, product reads, product edits, image upload, orders and admin actions.
5. Test Paystack Test-mode checkout and the existing webhook flow against Preview only.
6. Confirm payment confirmation, duplicate webhook handling, 10-minute reservation expiry, stock release, and no stock deduction for unsuccessful payments.
7. Confirm no Preview request or webhook changes Neon Production.

The Paystack webhook handler path and business logic are not changed by this deployment setup. Configure the same webhook path on the Cloudflare endpoint for the relevant Paystack mode only after the Preview URL is confirmed.

## Production gate

The Production Hyperdrive placeholder and Production secrets must remain unset until Preview acceptance is complete. Keep the current Vercel Production deployment and Neon Production data untouched during Preview work.
