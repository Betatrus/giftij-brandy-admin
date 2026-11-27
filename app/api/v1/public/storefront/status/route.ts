import { NextRequest } from "next/server";
import { ok } from "@/lib/api/respond";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const settings = await prisma.storeSettings.findUnique({
    where: { id: "singleton" },
    select: { storefrontLocked: true, storefrontLockMessage: true, storefrontUnlocksAt: true },
  });
  const locked = Boolean(settings?.storefrontLocked);
  return withCors(ok({
    locked,
    message: locked ? settings?.storefrontLockMessage || "Our online store is temporarily closed. Please check back soon." : null,
    reopeningAt: locked ? settings?.storefrontUnlocksAt?.toISOString() ?? null : null,
  }), req.headers.get("origin"));
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
