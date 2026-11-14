import type { NextRequest } from "next/server";

// Defer Auth.js and its Prisma adapter until an auth request is handled.
export async function GET(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  const { handlers } = await import("@/auth");
  return handlers.POST(req);
}
