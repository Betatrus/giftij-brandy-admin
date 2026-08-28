import { Resend } from "resend";

/**
 * The `resend` package and `RESEND_API_KEY` were already present (package.json,
 * .env.example) before Phase 6, but no client wrapper actually existed yet —
 * unlike lib/cloudinary.ts, which this file mirrors the shape of. Built here as
 * part of Communication (§42) rather than assumed pre-built.
 */
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "Giftij Brandy <no-reply@giftijbrandy.com>";

export async function sendEmail(params: { to: string; subject: string; html: string }) {
  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (result.error) {
    throw new Error(`Resend failed to send to ${params.to}: ${result.error.message}`);
  }

  return result.data;
}
