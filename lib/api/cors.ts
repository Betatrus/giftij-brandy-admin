/**
 * Allowed origins for /api/v1/public/*. Configurable via env so preview
 * deployments and local dev can add their own storefront URL without a
 * code change. Defaults cover production.
 */
function getAllowedOrigins(): string[] {
  const fromEnv = process.env.PUBLIC_API_ALLOWED_ORIGINS;
  if (fromEnv) return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://www.giftij.com", "https://giftij.com"];
}

export function corsHeaders(requestOrigin: string | null): HeadersInit {
  const allowed = getAllowedOrigins();
  const origin = requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : allowed[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Mutates and returns the response with CORS headers applied. */
export function withCors(response: Response, requestOrigin: string | null): Response {
  const headers = corsHeaders(requestOrigin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value as string);
  }
  return response;
}

/** Standard preflight (OPTIONS) response for a public API route. */
export function corsPreflight(requestOrigin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin) });
}
