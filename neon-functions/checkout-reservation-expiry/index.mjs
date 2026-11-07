function isValidTriggerDelivery(request, body) {
  const invocationId = request.headers.get("x-neon-trigger-invocation-id");
  return Boolean(
    invocationId && body && body.version === 1 &&
    body.invocation_id === invocationId && body.trigger?.type === "schedule"
  );
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Neon strips caller-supplied x-neon-* headers. Matching this header to
    // the delivery body authenticates the scheduled invocation.
    if (!isValidTriggerDelivery(request, body)) {
      return Response.json({ error: "Unauthorized trigger delivery" }, { status: 401 });
    }

    const target = process.env.PREVIEW_CLEANUP_URL;
    const cronSecret = process.env.CRON_SECRET;
    const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (!target || !cronSecret || !protectionBypass) {
      console.error("Missing Preview cleanup proxy configuration.");
      return Response.json({ error: "Cleanup proxy is not configured" }, { status: 500 });
    }

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cronSecret}`,
          "x-vercel-protection-bypass": protectionBypass,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: "neon-function-trigger",
          scheduledAt: body.data?.scheduled_at ?? null,
        }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });

      const responseBody = await response.text();
      if (!response.ok) {
        console.error("Preview cleanup endpoint failed", response.status, responseBody.slice(0, 500));
        return Response.json(
          { error: "Preview cleanup endpoint failed", status: response.status },
          { status: 502 },
        );
      }

      return Response.json({ ok: true, previewResponse: responseBody });
    } catch (error) {
      console.error("Could not reach Preview cleanup endpoint:", error);
      return Response.json({ error: "Could not reach Preview cleanup endpoint" }, { status: 502 });
    }
  },
};
