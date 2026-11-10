# Checkout reservation expiry

The Neon Function Trigger runs once per minute on the isolated Preview branch. It calls the Admin Preview cron route `GET /api/cron/expire-checkout-reservations` with the branch-scoped `CRON_SECRET` and Vercel deployment-protection bypass header. The route delegates to `releaseExpiredCheckoutReservations(25)`, keeping the existing inventory release transaction as the single source of truth.
