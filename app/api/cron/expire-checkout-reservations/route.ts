import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredCheckoutReservations } from "@/lib/orders/stock-reservation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET is not configured.");
    return NextResponse.json(
      { error: "Cron endpoint is not configured." },
      { status: 503 },
    );
  }

  const authorization = req.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    // Keep each scheduled invocation bounded. Reservation-level conditional
    // state transitions make concurrent cleanup and checkout cleanup idempotent.
    const released = await releaseExpiredCheckoutReservations(25);

    return NextResponse.json({
      ok: true,
      released,
    });
  } catch (error) {
    console.error("Checkout reservation cron failed:", error);
    return NextResponse.json(
      { error: "Reservation cleanup failed." },
      { status: 500 },
    );
  }
}
