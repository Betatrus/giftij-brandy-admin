import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Creates the Giftij Brandy Preview Super Admin only.
 *
 * Safety contract:
 * - Requires an explicit Preview Neon connection; never falls back to DATABASE_URL.
 * - Requires two explicit Preview confirmations and a one-time password secret.
 * - Does not reset or overwrite an existing account's password.
 * - Never logs the password or password hash.
 *
 * Run manually after migrations against the isolated Preview database:
 * SEED_TARGET=preview
 * SEED_PREVIEW_DATABASE_CONFIRMATION=giftij-brandy-preview-test
 * PREVIEW_DATABASE_URL=...
 * SEED_SUPER_ADMIN_PASSWORD=...
 * npm run prisma:seed-preview-admin
 */

async function main() {
  if (process.env.SEED_TARGET !== "preview") {
    throw new Error('Refusing to seed: set SEED_TARGET="preview" explicitly.');
  }

  if (
    process.env.SEED_PREVIEW_DATABASE_CONFIRMATION !==
    "giftij-brandy-preview-test"
  ) {
    throw new Error(
      "Refusing to seed: confirm the isolated database by setting " +
        'SEED_PREVIEW_DATABASE_CONFIRMATION="giftij-brandy-preview-test".',
    );
  }

  const databaseUrl = process.env.PREVIEW_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "Refusing to seed: PREVIEW_DATABASE_URL is required. " +
        "The script never falls back to DATABASE_URL.",
    );
  }

  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "SEED_SUPER_ADMIN_PASSWORD is required and must be at least 12 characters.",
    );
  }

  const email = (
    process.env.SEED_SUPER_ADMIN_EMAIL ?? "bright@gifijbrandy.com"
  )
    .trim()
    .toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("SEED_SUPER_ADMIN_EMAIL must be a valid email address.");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role !== "SUPER_ADMIN" || !existing.isActive) {
        throw new Error(
          "The Preview admin email already exists but is not an active SUPER_ADMIN. " +
            "No account fields were changed; review it manually.",
        );
      }

      console.log(
        "Preview Super Admin already exists and is active. Password was not changed.",
      );
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name: process.env.SEED_SUPER_ADMIN_NAME?.trim() || "Bright",
        email,
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
      },
    });

    console.log("Preview Super Admin created successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Preview admin seeding failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
