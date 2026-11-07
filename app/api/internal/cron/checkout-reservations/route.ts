import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { releaseExpiredCheckoutReservations } from "@/lib/orders/stock-reservation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  if (!configured || !supplied.startsWith("Bearer ")) return false;

  const expected = Buffer.from(configured);
  const received = Buffer.from(supplied.slice(7));
  return expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const released = await releaseExpiredCheckoutReservations(50);
    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      released,
    });
  } catch (error) {
    console.error("Scheduled checkout reservation expiry failed:", error);
    return NextResponse.json(
      { error: "Reservation expiry failed" },
      { status: 500 },
    );
  }
}
