import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./api-error";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

/** Success envelope — every public API 2xx response uses this. */
export function ok<T>(data: T, meta?: PaginationMeta, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data, ...(meta ? { meta } : {}) },
    { status }
  );
}

/**
 * Error envelope — pass any caught error and this figures out the right
 * shape and HTTP status. Route handlers should wrap their body in
 * try/catch and call `fail(error)` in the catch block rather than
 * hand-rolling error responses, so every endpoint's errors are uniform.
 */
export function fail(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request.",
          details: error.flatten(),
        },
      },
      { status: 400 }
    );
  }

  // Anything else is unexpected — log it server-side with full detail,
  // but never leak internals to the client.
  console.error("Unhandled public API error:", error);
  return NextResponse.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    },
    { status: 500 }
  );
}
