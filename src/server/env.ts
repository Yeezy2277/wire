import { z } from "zod";

/** Blank strings mean "not set": Vercel and .env files both produce them. */
const opt = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), z.string().optional());
const url = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), z.string().url().optional());

const Schema = z
  .object({
    SITE_URL: url,
    SITE_TITLE: opt,
    SITE_DESCRIPTION: opt,
    SITE_LANGUAGE: opt,
    WIRE_URL: url,
    CONTENTFUL_SPACE_ID: opt,
    CONTENTFUL_ACCESS_TOKEN: opt,
    CONTENTFUL_ENVIRONMENT: opt,
    WIRE_CONTENT_TYPES: opt,
    NEWS_MINIMUM_ARTICLES: z.coerce.number().int().min(0).optional().catch(undefined),
    WEBHOOK_SECRET: opt,
    CRON_SECRET: opt,
    UPSTASH_REDIS_REST_URL: url,
    UPSTASH_REDIS_REST_TOKEN: opt,
    KV_REST_API_URL: url,
    KV_REST_API_TOKEN: opt,
    QSTASH_URL: url,
    QSTASH_TOKEN: opt,
    QSTASH_CURRENT_SIGNING_KEY: opt,
    QSTASH_NEXT_SIGNING_KEY: opt,
    VERCEL_PROJECT_PRODUCTION_URL: opt,
  })
  .superRefine((e, ctx) => {
    // Half-configured services are the dangerous case: they silently fall back
    // to a stand-in (or, worse, run live without auth). Refuse to start instead.
    const pair = (a: keyof typeof e, b: keyof typeof e) => {
      if (Boolean(e[a]) !== Boolean(e[b])) ctx.addIssue({ code: "custom", path: [a], message: `${a} and ${b} must be set together` });
    };
    pair("CONTENTFUL_SPACE_ID", "CONTENTFUL_ACCESS_TOKEN");
    pair("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
    pair("KV_REST_API_URL", "KV_REST_API_TOKEN");
    if (e.QSTASH_TOKEN && !e.QSTASH_CURRENT_SIGNING_KEY) {
      ctx.addIssue({ code: "custom", path: ["QSTASH_CURRENT_SIGNING_KEY"], message: "required when QSTASH_TOKEN is set, or the worker can't verify deliveries" });
    }
    if (e.CONTENTFUL_SPACE_ID && !e.WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["WEBHOOK_SECRET"], message: "required on the live pipeline, or the webhook is open" });
    }
  });

export type Env = z.infer<typeof Schema>;

/** Parses the environment once; a misconfiguration fails with every problem listed, never a value. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = Schema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Wire is misconfigured:\n${problems}\nSee .env.example.`);
}
