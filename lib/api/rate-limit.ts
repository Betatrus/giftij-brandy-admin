/**
 * MVP rate limiter — in-memory, per serverless-instance. This is a known,
 * accepted limitation: it doesn't share state across concurrent Vercel
 * function instances or regions, so the effective limit under heavy
 * concurrent load is "per instance," not global. That's fine at MVP
 * traffic levels. If/when this needs to be a hard global limit, swap this
 * module's internals for a Redis-backed limiter (e.g. Upstash) — nothing
 * about the call site (`checkRateLimit`) would need to change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Periodically clear expired buckets so this Map doesn't grow unbounded
// over a long-lived serverless instance's lifetime.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();
