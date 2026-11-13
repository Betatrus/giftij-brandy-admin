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

npm run build
