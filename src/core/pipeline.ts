import { createHash } from "node:crypto";
import { buildFeeds, type Partner } from "./build";
import { dedupKey, parseContentfulEvent, type EventFilter } from "./event";
import type { ContentSource, Kv, Queue } from "./ports";
import type { EventLogEntry, EventOutcome, FeedFile, FeedJob, Site } from "./types";

export const DEDUP_TTL_SECONDS = 5 * 60;
const LOG_KEY = "wire:events";
const LOG_MAX = 50;
const feedKey = (path: string) => `wire:feed:${path}`;
const INDEX_KEY = "wire:feeds";

export type StoredFeed = FeedFile & { hash: string; updatedAt: string };

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type PipelineDeps = {
  kv: Kv;
  queue: Queue;
  content: ContentSource;
  site: Site;
  filter: EventFilter;
  partners?: Partner[];
  newsMinimumArticles?: number;
  clock?: () => Date;
};

export function createPipeline(deps: PipelineDeps) {
  const now = () => deps.clock?.() ?? new Date();

  async function log(entry: Omit<EventLogEntry, "at">) {
    await deps.kv.pushCapped(LOG_KEY, JSON.stringify({ at: now().toISOString(), ...entry }), LOG_MAX);
  }

  /** Receiver: authenticate upstream, then filter → dedup → enqueue. Cheap and fast, so the webhook acks quickly. */
  async function receive(topic: string | null, body: unknown): Promise<EventOutcome> {
    const parsed = parseContentfulEvent(topic, body, deps.filter, now());
    if (!parsed.ok) {
      const outcome: EventOutcome = { kind: "ignored", reason: parsed.reason };
      await log({ stage: "receiver", outcome });
      return outcome;
    }
    const { job } = parsed;
    const key = dedupKey(job);
    const fresh = await deps.kv.setIfAbsent(`wire:dedup:${key}`, job.receivedAt, DEDUP_TTL_SECONDS);
    const outcome: EventOutcome = fresh ? { kind: "queued", key } : { kind: "deduped", key };
    await log({ stage: "receiver", entryId: job.entryId, action: job.action, outcome });
    if (fresh) await deps.queue.enqueue(job, key);
    return outcome;
  }

  /**
   * Worker: rebuild every feed from the current published state, then write
   * only the files whose bytes changed. Rebuilding everything keeps the worker
   * stateless and makes retries and out-of-order jobs harmless: any run
   * converges to the same output.
   */
  async function process(job: FeedJob): Promise<EventOutcome> {
    const started = Date.now();
    try {
      const articles = await deps.content.listArticles();
      const files = buildFeeds({
        site: deps.site,
        articles,
        now: now(),
        partners: deps.partners,
        newsMinimumArticles: deps.newsMinimumArticles,
      });

      const changed: string[] = [];
      for (const file of files) {
        const hash = sha256(file.body);
        const existing = await deps.kv.get(feedKey(file.path));
        if (existing && (JSON.parse(existing) as StoredFeed).hash === hash) continue;
        const stored: StoredFeed = { ...file, hash, updatedAt: now().toISOString() };
        await deps.kv.set(feedKey(file.path), JSON.stringify(stored));
        changed.push(file.path);
      }
      // A feed that's no longer generated (last post with a tag unpublished) must
      // disappear, not linger with stale items.
      const current = new Set(files.map((f) => f.path));
      const previous = await listFeeds();
      const removed = previous.filter((p) => !current.has(p));
      for (const path of removed) await deps.kv.delete(feedKey(path));
      await deps.kv.set(INDEX_KEY, JSON.stringify([...current]));
      changed.push(...removed.map((p) => `-${p}`));

      const outcome: EventOutcome = {
        kind: "rebuilt",
        changed,
        unchanged: files.length - changed.length,
        ms: Date.now() - started,
      };
      await log({ stage: "worker", entryId: job.entryId, action: job.action, outcome });
      return outcome;
    } catch (err) {
      const outcome: EventOutcome = { kind: "failed", error: err instanceof Error ? err.message : String(err) };
      await log({ stage: "worker", entryId: job.entryId, action: job.action, outcome });
      // Rethrow so the queue retries the job.
      throw err;
    }
  }

  async function readFeed(path: string): Promise<StoredFeed | null> {
    const raw = await deps.kv.get(feedKey(path));
    return raw ? (JSON.parse(raw) as StoredFeed) : null;
  }

  async function listFeeds(): Promise<string[]> {
    const raw = await deps.kv.get(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  async function recentEvents(count = LOG_MAX): Promise<EventLogEntry[]> {
    return (await deps.kv.readList(LOG_KEY, count)).map((s) => JSON.parse(s) as EventLogEntry);
  }

  return { receive, process, readFeed, listFeeds, recentEvents };
}

export type Pipeline = ReturnType<typeof createPipeline>;
