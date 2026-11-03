import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredCheckoutReservations } from "@/lib/orders/stock-reservation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    // Run outside the customer checkout path. The cleanup function claims
    // each reservation atomically, so overlapping invocations cannot
    // release the same reservation twice.
    const released = await releaseExpiredCheckoutReservations(100);

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
