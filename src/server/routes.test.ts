import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetContainer } from "./container";
import { POST as worker } from "@/app/api/worker/route";
import { POST as webhook } from "@/app/api/webhooks/contentful/route";
import { GET as rebuild } from "@/app/api/rebuild/route";

const ORIGINAL = { ...process.env };
function withEnv(vars: Record<string, string>) {
  process.env = { ...ORIGINAL, ...vars };
  resetContainer();
}
afterEach(() => {
  process.env = { ...ORIGINAL };
  resetContainer();
});

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
function qstashJwt(key: string, url: string, body: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: "Upstash", sub: url, exp: now + 300, nbf: now - 1, body: b64url(createHash("sha256").update(body).digest()) }),
  );
  return `${header}.${payload}.${b64url(createHmac("sha256", key).update(`${header}.${payload}`).digest())}`;
}

const LIVE = {
  WIRE_URL: "https://wire.example",
  CONTENTFUL_SPACE_ID: "space",
  CONTENTFUL_ACCESS_TOKEN: "cda",
  WEBHOOK_SECRET: "zq-expected-value",
  CRON_SECRET: "cron-secret",
  QSTASH_TOKEN: "q",
  QSTASH_CURRENT_SIGNING_KEY: "sign-current",
};

describe("worker route", () => {
  it("drops a correctly signed body that isn't JSON instead of failing (QStash would retry a 5xx forever)", async () => {
    withEnv(LIVE);
    const body = "not json {";
    const res = await worker(
      new Request("https://wire.example/api/worker", {
        method: "POST",
        body,
        headers: { "upstash-signature": qstashJwt("sign-current", "https://wire.example/api/worker", body) },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dropped: true, reason: "body is not JSON" });
  });

  it("rejects an unsigned delivery with the error envelope", async () => {
    withEnv(LIVE);
    const res = await worker(new Request("https://wire.example/api/worker", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "invalid_signature" });
    expect(json.requestId).toBe(res.headers.get("x-request-id"));
  });
});

describe("webhook route", () => {
  it("refuses a wrong secret without revealing the expected one", async () => {
    withEnv(LIVE);
    const res = await webhook(
      new Request("https://wire.example/api/webhooks/contentful", {
        method: "POST",
        body: "{}",
        headers: { "x-webhook-secret": "guess", "x-request-id": "req-1" },
      }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ error: "unauthorized", message: expect.any(String), requestId: "req-1" });
    expect(JSON.stringify(json)).not.toContain("zq-expected-value");
  });
});

describe("rebuild route", () => {
  it("requires the cron token on the live pipeline", async () => {
    withEnv(LIVE);
    const res = await rebuild(new Request("https://wire.example/api/rebuild", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });
});
