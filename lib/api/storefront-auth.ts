import { timingSafeEqual } from "node:crypto";

/**
 * Authenticates trusted server-to-server storefront catalogue requests.
 *
 * The credential lives only in server environment variables.
 *
 * It must never be placed in:
 *
 * - NEXT_PUBLIC_* variables
 * - browser JavaScript
 * - localStorage
 * - cookies accessible to client JavaScript
 * - mobile application binaries
 */

function secureCompare(
  supplied: string,
  expected: string
): boolean {
  const suppliedBuffer = Buffer.from(
    supplied,
    "utf8"
  );

  const expectedBuffer = Buffer.from(
    expected,
    "utf8"
  );

  if (
    suppliedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    suppliedBuffer,
    expectedBuffer
  );
}

export function hasValidStorefrontKey(
  request: Request
): boolean {
  const expected =
    process.env.STOREFRONT_API_SECRET?.trim();

  const supplied =
    request.headers
      .get("x-storefront-key")
      ?.trim();

  if (!expected || !supplied) {
    return false;
  }

  return secureCompare(
    supplied,
    expected
  );
}

export function storefrontUnauthorizedResponse(): Response {
  return Response.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Unauthorized request.",
      },
    },
    {
      status: 401,
      headers: {
        "Cache-Control":
          "no-store, private, max-age=0",
      },
    }
  );
}