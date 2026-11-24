type SendEmailInput = { to: string; subject: string; html: string; toName?: string; idempotencyKey?: string; tags?: string[] };

/** Sends transactional email through Brevo's v3 SMTP API. */
export async function sendEmail(params: SendEmailInput): Promise<{ messageId: string | null }> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Giftij Brandy";
  if (!apiKey || !senderEmail) throw new Error("Brevo is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: params.to, ...(params.toName ? { name: params.toName } : {}) }],
      subject: params.subject, htmlContent: params.html,
      ...(params.tags?.length ? { tags: params.tags } : {}),
      ...(params.idempotencyKey ? { headers: { IdempotencyKey: params.idempotencyKey } } : {}),
    }),
  });
  const result = (await response.json().catch(() => null)) as { messageId?: string; code?: string; message?: string } | null;
  if (!response.ok) throw new Error(`Brevo transactional email failed (HTTP ${response.status}): ${result?.message ?? result?.code ?? "unknown provider error"}`);
  return { messageId: typeof result?.messageId === "string" ? result.messageId : null };
}
