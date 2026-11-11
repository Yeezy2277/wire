import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapEntry } from "./contentful";
import { verifyQStashSignature } from "./queue";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

function sign(key: string, claims: Record<string, unknown>) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac("sha256", key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

describe("verifyQStashSignature", () => {
  const url = "https://wire.example/api/worker";
  const body = '{"entryId":"p1"}';
  const now = 1_800_000_000_000;
  const claims = {
    iss: "Upstash",
    sub: url,
    exp: now / 1000 + 300,
    nbf: now / 1000 - 1,
    body: b64url(createHash("sha256").update(body).digest()),
  };

  it("accepts a token signed with either the current or the next key", () => {
    expect(verifyQStashSignature({ jwt: sign("current", claims), body, url, keys: ["current", "next"], now }).ok).toBe(true);
    expect(verifyQStashSignature({ jwt: sign("next", claims), body, url, keys: ["current", "next"], now }).ok).toBe(true);
  });

  it("rejects a wrong key, a tampered body, another URL and an expired token", () => {
    const check = (jwt: string, b = body, u = url) => verifyQStashSignature({ jwt, body: b, url: u, keys: ["current"], now });
    expect(check(sign("attacker", claims))).toEqual({ ok: false, reason: "bad signature" });
    expect(check(sign("current", claims), '{"entryId":"evil"}')).toEqual({ ok: false, reason: "body was altered" });
    expect(check(sign("current", claims), body, "https://other/api/worker")).toMatchObject({ ok: false });
    expect(check(sign("current", { ...claims, exp: now / 1000 - 1 }))).toEqual({ ok: false, reason: "token expired" });
    expect(verifyQStashSignature({ jwt: null, body, url, keys: ["current"], now }).ok).toBe(false);
  });
});

describe("mapEntry", () => {
  const sys = { id: "e1", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z", contentType: { sys: { id: "blogPost" } } };

  it("resolves the cover asset and author, and normalizes protocol-relative URLs", () => {
    const assets = new Map([
      ["img", { sys: { id: "img" }, fields: { description: "Alt", file: { url: "//images.ctfassets.net/x.jpg", details: { image: { width: 800, height: 400 } } } } }],
    ]);
    const entries = new Map([["auth", { sys: { ...sys, id: "auth" }, fields: { name: "Vitalii" } }]]);
    const a = mapEntry(
      {
        sys,
        fields: {
          title: "Hello",
          slug: "hello",
          publishedDate: "2026-11-01T10:00:00Z",
          tags: ["A"],
          coverImage: { sys: { id: "img", type: "Link", linkType: "Asset" } },
          author: { sys: { id: "auth", type: "Link", linkType: "Entry" } },
          estimatedReadingTime: 4,
        },
      },
      assets,
      entries,
    );
    expect(a).toMatchObject({
      slug: "hello",
      author: "Vitalii",
      readingTimeMinutes: 4,
      image: { url: "https://images.ctfassets.net/x.jpg", width: 800, height: 400, alt: "Alt" },
    });
  });

  it("skips entries a feed can't link to", () => {
    expect(mapEntry({ sys, fields: { title: "No slug" } }, new Map(), new Map())).toBeNull();
  });
});
