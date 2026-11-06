#!/bin/sh
set -eu

# Only the explicitly opted-in Preview branch may migrate the isolated
# staging database. Production builds and all other Preview branches skip it.
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${RUN_PREVIEW_MIGRATIONS:-}" = "1" ]; then
  echo "Applying Prisma migrations to the isolated Preview database."
  npx prisma migrate deploy
fi

npm run build
