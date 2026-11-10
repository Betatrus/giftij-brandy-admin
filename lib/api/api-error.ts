export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "OUT_OF_STOCK",
  "OFFER_UNAVAILABLE",
  "RATE_LIMITED",
  "PAYMENT_INIT_FAILED",
  "WEBHOOK_SIGNATURE_INVALID",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  OFFER_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  PAYMENT_INIT_FAILED: 502,
  WEBHOOK_SIGNATURE_INVALID: 401,
  INTERNAL_ERROR: 500,
};

/**
 * Throw this from any public API route handler. `lib/api/respond.ts`'s
 * `fail()` knows how to turn it into the standard error envelope with the
 * right HTTP status — route handlers never construct NextResponse.json
 * error bodies by hand.
 */
export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
