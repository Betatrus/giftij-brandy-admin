import type { NextRequest } from "next/server";

export const runtime = "nodejs";

// Keep the database-backed webhook implementation out of build-time route evaluation.
export async function POST(req: NextRequest) {
  const { POST: handlePaystackWebhook } = await import("./handler");
  return handlePaystackWebhook(req);
}
