import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Temporary, read-only diagnostic for the single Preview payment under investigation.
// It deliberately accepts no caller-supplied reference and never writes to Giftij's database.
const REFERENCE = "T390025971550374";

export async function GET() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ checked: false, error: "Preview Paystack key is not configured." }, { status: 503 });
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(REFERENCE)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== true || !payload?.data) {
      return NextResponse.json(
        { checked: false, httpStatus: response.status, message: payload?.message ?? "Paystack verification request failed." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const transaction = payload.data;
    if (transaction.reference !== REFERENCE) {
      return NextResponse.json({ checked: false, error: "Paystack returned a different reference." }, { status: 502 });
    }

    return NextResponse.json(
      {
        checked: true,
        reference: transaction.reference,
        domain: transaction.domain,
        status: transaction.status,
        amountKobo: transaction.amount,
        currency: transaction.currency,
        paidAt: transaction.paid_at ?? null,
        gatewayResponse: transaction.gateway_response ?? null,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { checked: false, error: "Could not reach Paystack verification API." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
