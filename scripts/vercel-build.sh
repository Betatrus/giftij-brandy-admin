#!/bin/sh
set -eu

# Preview migrations must never run in a Production build, even if the
# RUN_PREVIEW_MIGRATIONS variable is accidentally configured on Production.
if [ "${RUN_PREVIEW_MIGRATIONS:-}" = "1" ]; then
  if [ "${VERCEL_ENV:-}" != "preview" ]; then
    echo "Refusing to run Preview database migrations outside a Vercel Preview build (VERCEL_ENV=${VERCEL_ENV:-unset})." >&2
    exit 1
  fi

  echo "Applying Prisma migrations to the isolated Preview database."
  npx prisma migrate deploy
  node scripts/verify-preview-db.cjs
  npx tsx scripts/preview-integration-tests.ts
fi

# Apply additive Production schema migrations before compiling the matching app.
# If a migration fails, stop the build and keep the previous deployment serving traffic.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Reconciling previously-applied Production migrations."
  node scripts/repair-production-migration-history.cjs
  echo "Applying Prisma migrations to the Production database."
  npx prisma migrate deploy
fi

npm run build
