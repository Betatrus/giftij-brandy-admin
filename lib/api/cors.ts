/**
 * Allowed origins for /api/v1/public/*.
 *
 * Production storefront origins are always allowed.
 * Additional origins, such as localhost or preview deployments,
 * can be added through PUBLIC_API_ALLOWED_ORIGINS.
 */
function getAllowedOrigins(): string[] {
  const defaults = [
    "https://giftij-brandy-frontend.vercel.app",
    "https://www.giftijbrandy.com",
    "https://giftijbrandy.com",
  ];

  const fromEnv = process.env.PUBLIC_API_ALLOWED_ORIGINS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

  return [...new Set([...defaults, ...fromEnv])];
}

export function corsHeaders(requestOrigin: string | null): HeadersInit {
  const allowed = getAllowedOrigins();

  const origin =
    requestOrigin && allowed.includes(requestOrigin)
      ? requestOrigin
      : allowed[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Mutates and returns the response with CORS headers applied. */
export function withCors(
  response: Response,
  requestOrigin: string | null
): Response {
  const headers = corsHeaders(requestOrigin);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value as string);
  }

  return response;
}

/** Standard preflight (OPTIONS) response for a public API route. */
export function corsPreflight(requestOrigin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(requestOrigin),
  });
}