#!/bin/sh
set -eu

# RUN_PREVIEW_MIGRATIONS exists only in Vercel's Preview environment.
# Production has no such variable and therefore never runs this migration step.
if [ "${RUN_PREVIEW_MIGRATIONS:-}" = "1" ]; then
  echo "Applying Prisma migrations to the isolated Preview database."
  npx prisma migrate deploy
  node scripts/verify-preview-db.cjs
  npx tsx scripts/preview-integration-tests.ts
fi

npm run build
