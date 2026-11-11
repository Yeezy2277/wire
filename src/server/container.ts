import { ContentfulSource } from "@/adapters/contentful";
import { FixtureSource } from "@/adapters/fixtures";
import { MemoryKv, UpstashKv } from "@/adapters/kv";
import { InlineQueue, QStashQueue } from "@/adapters/queue";
import { createPipeline, type Pipeline } from "@/core/pipeline";
import type { ContentSource, Kv, Queue } from "@/core/ports";
import type { FeedJob, Site } from "@/core/types";

const env = (name: string) => process.env[name]?.trim() || undefined;

export type Mode = {
  store: "upstash" | "memory";
  queue: "qstash" | "inline";
  content: "contentful" | "sample";
  /** True when anything runs on stand-ins; the demo panel is only offered then. */
  demo: boolean;
};

type Container = { pipeline: Pipeline; mode: Mode; fixtures?: FixtureSource; workerUrl: string; signingKeys: string[] };

export function site(): Site {
  return {
    url: env("SITE_URL") ?? "https://lumen.vitaliipopov.dev",
    title: env("SITE_TITLE") ?? "The Lumen Review",
    description: env("SITE_DESCRIPTION") ?? "Writing on craft, systems, and the work behind the screen.",
    language: env("SITE_LANGUAGE") ?? "en",
    // On Vercel, fall back to the project's production domain so feed self-links are right without config.
    wireUrl:
      env("WIRE_URL") ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  };
}

function build(): Container {
  const s = site();
  const workerUrl = `${s.wireUrl.replace(/\/$/, "")}/api/worker`;

  const upstashUrl = env("UPSTASH_REDIS_REST_URL");
  const upstashToken = env("UPSTASH_REDIS_REST_TOKEN");
  const kv: Kv = upstashUrl && upstashToken ? new UpstashKv(upstashUrl, upstashToken) : new MemoryKv();

  const spaceId = env("CONTENTFUL_SPACE_ID");
  const cdaToken = env("CONTENTFUL_ACCESS_TOKEN");
  const environment = env("CONTENTFUL_ENVIRONMENT") ?? "master";
  const contentTypes = (env("WIRE_CONTENT_TYPES") ?? "blogPost").split(",").map((t) => t.trim()).filter(Boolean);
  const fixtures = spaceId && cdaToken ? undefined : new FixtureSource();
  const content: ContentSource = fixtures ?? new ContentfulSource(spaceId!, environment, cdaToken!, contentTypes[0]);

  const qstashToken = env("QSTASH_TOKEN");
  // The queue needs the pipeline and the pipeline needs the queue; a late-bound handler breaks the cycle.
  let handle: (job: FeedJob) => Promise<unknown> = async () => undefined;
  const queue: Queue = qstashToken
    ? new QStashQueue(env("QSTASH_URL") ?? "https://qstash.upstash.io", qstashToken, workerUrl)
    : new InlineQueue((job) => handle(job));

  const pipeline = createPipeline({
    kv,
    queue,
    content,
    site: s,
    filter: { environment, contentTypes },
    // A low-volume demo blog would have an empty Google News sitemap most days.
    newsMinimumArticles: fixtures ? 3 : Number(env("NEWS_MINIMUM_ARTICLES") ?? 0),
  });
  handle = (job) => pipeline.process(job);

  const mode: Mode = {
    store: kv instanceof UpstashKv ? "upstash" : "memory",
    queue: qstashToken ? "qstash" : "inline",
    content: fixtures ? "sample" : "contentful",
    demo: Boolean(fixtures),
  };
  const signingKeys = [env("QSTASH_CURRENT_SIGNING_KEY"), env("QSTASH_NEXT_SIGNING_KEY")].filter((k): k is string => !!k);
  return { pipeline, mode, fixtures, workerUrl, signingKeys };
}

// One container per server process. Kept on globalThis so dev-mode module
// reloads don't wipe the in-memory demo state.
const g = globalThis as unknown as { __wire?: Container };
export const container = (): Container => (g.__wire ??= build());

/** Demo mode only: make sure there's something to look at on first visit. */
export async function ensureBuilt(): Promise<void> {
  const { pipeline, mode } = container();
  if (!mode.demo) return;
  if ((await pipeline.listFeeds()).length > 0) return;
  await pipeline.process({ entryId: "bootstrap", action: "publish", version: 0, receivedAt: new Date().toISOString() });
}
