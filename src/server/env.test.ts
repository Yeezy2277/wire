import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts an empty environment: demo mode needs no config", () => {
    expect(() => parseEnv({})).not.toThrow();
  });

  it("treats blank values as unset and trims the rest", () => {
    const env = parseEnv({ WEBHOOK_SECRET: "  s3cret ", CRON_SECRET: "   " });
    expect(env.WEBHOOK_SECRET).toBe("s3cret");
    expect(env.CRON_SECRET).toBeUndefined();
  });

  it("refuses half-configured services and lists every problem", () => {
    const run = () =>
      parseEnv({ CONTENTFUL_SPACE_ID: "space", QSTASH_TOKEN: "t", UPSTASH_REDIS_REST_URL: "https://kv.example" });
    expect(run).toThrow(/CONTENTFUL_SPACE_ID and CONTENTFUL_ACCESS_TOKEN must be set together/);
    expect(run).toThrow(/QSTASH_CURRENT_SIGNING_KEY: required/);
    expect(run).toThrow(/UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/);
  });

  it("refuses a live pipeline without a webhook secret", () => {
    expect(() => parseEnv({ CONTENTFUL_SPACE_ID: "space", CONTENTFUL_ACCESS_TOKEN: "tok" })).toThrow(/WEBHOOK_SECRET/);
  });

  it("never echoes a secret value in the error", () => {
    try {
      parseEnv({ QSTASH_TOKEN: "very-secret-token", SITE_URL: "not a url" });
    } catch (err) {
      expect(String(err)).not.toContain("very-secret-token");
      expect(String(err)).toContain("SITE_URL");
    }
  });
});
