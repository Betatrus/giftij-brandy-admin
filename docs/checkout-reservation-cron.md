# Checkout reservation expiry scheduler

Giftij Brandy checkout reservations last **10 minutes**. The application enforces that deadline during checkout/payment processing; this endpoint is the independent cleanup trigger that returns stock from abandoned or expired reservations to available inventory.

## Endpoint

- URL: `https://api.giftijbrandy.com/api/cron/expire-checkout-reservations` (production only after the route is deployed there)
- Method: `GET`
- Schedule: every **2 minutes**
- Header: `Authorization: Bearer <CRON_SECRET>`

Do not add a Vercel Cron entry to `vercel.json` for this endpoint. Use the external scheduler already selected for the project. Keep the schedule at two-minute intervals so stock is released promptly without relying on a customer revisiting the storefront.

## Secret setup

1. Generate a strong random secret, for example with `openssl rand -base64 32`.
2. Add it to the appropriate Vercel environment as `CRON_SECRET` (Preview for preview testing; Production only after the endpoint is deployed and approved for production).
3. Configure the external scheduler's request header as `Authorization: Bearer <the same secret>`.
4. Never paste the secret into GitHub, source files, screenshots, or chat.

The repository's `.env.example` contains a placeholder only. It is not a usable secret.

## Expected responses

- `200`: `{ "ok": true, "released": number }`. The number is how many reservations this invocation successfully expired and released.
- `401`: missing or incorrect bearer token.
- `503`: `CRON_SECRET` is not configured in the deployment.
- `500`: reservation cleanup failed; inspect deployment logs before retrying.

Each invocation processes at most 25 expired reservations. The cleanup claims each reservation with a conditional database state transition inside a transaction before restoring reserved stock. Repeated or overlapping calls therefore do not intentionally release the same reservation twice. A backlog is drained in bounded batches by later invocations.

## Safe validation sequence

1. Deploy this branch to a **Preview** environment with a Preview-only `CRON_SECRET`; do not point the scheduler at Production yet.
2. Call the endpoint without an Authorization header and confirm `401`.
3. Call with an incorrect token and confirm `401`.
4. Call with the correct Preview token and confirm `200` with a `released` count.
5. In a non-production database, create a test checkout reservation, confirm it is active and held for ten minutes, then wait until it expires.
6. Invoke the endpoint with the correct token. Confirm the reservation changes to `EXPIRED`, `reservedStock` decreases by the reserved quantity, and `currentStock` increases by the same quantity.
7. Invoke it again. Confirm `released: 0` for that reservation and that stock does not increase a second time.
8. Test two overlapping invocations against separate test reservations and confirm each reservation is released once.
9. Only after Preview validation, deploy/approve the endpoint in Production, configure the Production secret, and enable the external schedule.

Do not use real customer orders or Production inventory for these tests. A successful HTTP response alone is not proof of correctness; verify the reservation status and both stock counters in the non-production database.
