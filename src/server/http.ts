import { NextResponse } from "next/server";

/**
 * One error envelope for every API route: `{ error, message, details?, requestId }`.
 * `error` is a stable machine code, `message` says what to do. Internal
 * failures are logged with the request id and never echo raw exception text.
 */
export function requestId(req: Request): string {
  return req.headers.get("x-vercel-id") ?? req.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiError(rid: string, status: number, error: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error, message, ...(details === undefined ? {} : { details }), requestId: rid },
    { status, headers: { "x-request-id": rid } },
  );
}

export function apiOk(rid: string, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "x-request-id": rid } });
}

/** Logs the real error server-side and answers with a generic envelope. */
export function internalError(rid: string, where: string, err: unknown, status = 500) {
  console.error(`[${rid}] ${where} failed:`, err instanceof Error ? err.message : err);
  return apiError(rid, status, `${where}_failed`, `The ${where} failed. It is logged under request id ${rid}.`);
}

/** JSON.parse that reports failure instead of throwing. */
export function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}
