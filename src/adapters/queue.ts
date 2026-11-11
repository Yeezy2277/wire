import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Queue } from "@/core/ports";
import type { FeedJob } from "@/core/types";

/** Demo mode: run the worker right away, in-process. Same code path, no network hop. */
export class InlineQueue implements Queue {
  constructor(private handler: (job: FeedJob) => Promise<unknown>) {}

  async enqueue(job: FeedJob) {
    await this.handler(job);
  }
}

/**
 * Upstash QStash: an HTTP push queue. It POSTs the job to the worker URL and
 * retries with backoff until the worker returns 2xx: at-least-once delivery,
 * which is why the worker has to be idempotent.
 */
export class QStashQueue implements Queue {
  constructor(
    private baseUrl: string,
    private token: string,
    private workerUrl: string,
  ) {}

  async enqueue(job: FeedJob, dedupId: string) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v2/publish/${this.workerUrl}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        // QStash drops a second message with the same id: a second dedup layer
        // in case two receivers race past the Redis check.
        "Upstash-Deduplication-Id": dedupId.replace(/[^A-Za-z0-9._:-]/g, "_"),
        "Upstash-Retries": "3",
      },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error(`QStash publish failed: ${res.status} ${await res.text()}`);
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Verifies the `Upstash-Signature` JWT (HS256) QStash puts on each delivery:
 * signature, issuer, target URL, time window, and a hash of the exact body.
 * Accepts either the current or the next signing key so key rotation doesn't
 * drop messages.
 */
export function verifyQStashSignature(opts: {
  jwt: string | null;
  body: string;
  url: string;
  keys: string[];
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { jwt, body, url, keys } = opts;
  if (!jwt) return { ok: false, reason: "missing signature" };
  const parts = jwt.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [header, payload, signature] = parts as [string, string, string];

  const signed = `${header}.${payload}`;
  const valid = keys.filter(Boolean).some((key) => {
    const expected = Buffer.from(b64url(createHmac("sha256", key).update(signed).digest()));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!valid) return { ok: false, reason: "bad signature" };

  let claims: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "unreadable claims" };
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.iss !== "Upstash") return { ok: false, reason: "wrong issuer" };
  if (claims.sub !== url) return { ok: false, reason: "token was issued for another URL" };
  if (claims.exp !== undefined && nowSec > claims.exp) return { ok: false, reason: "token expired" };
  if (claims.nbf !== undefined && nowSec < claims.nbf) return { ok: false, reason: "token not yet valid" };
  const bodyHash = b64url(createHash("sha256").update(body).digest());
  if (claims.body?.replace(/=+$/, "") !== bodyHash) return { ok: false, reason: "body was altered" };
  return { ok: true };
}
