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

  async function log(entry: Omit<EventLogEntry, "at" | "id">) {
    const full: EventLogEntry = { id: crypto.randomUUID(), at: now().toISOString(), ...entry };
    await deps.kv.pushCapped(LOG_KEY, JSON.stringify(full), LOG_MAX);
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
    const marker = `wire:dedup:${key}`;
    const fresh = await deps.kv.setIfAbsent(marker, job.receivedAt, DEDUP_TTL_SECONDS);
    if (!fresh) {
      const outcome: EventOutcome = { kind: "deduped", key };
      await log({ stage: "receiver", entryId: job.entryId, action: job.action, outcome });
      return outcome;
    }
    try {
      await deps.queue.enqueue(job, key);
    } catch (err) {
      // Release the marker: otherwise the sender's retry would be "deduped" and
      // the event lost for good, the opposite of what dedup is for.
      await deps.kv.delete(marker);
      const outcome: EventOutcome = { kind: "failed", error: err instanceof Error ? err.message : String(err) };
      await log({ stage: "receiver", entryId: job.entryId, action: job.action, outcome });
      throw err;
    }
    const outcome: EventOutcome = { kind: "queued", key };
    await log({ stage: "receiver", entryId: job.entryId, action: job.action, outcome });
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

      // One read for every existing file, then one atomic write: a reader never
      // sees half a rebuild, and the cost stays at two round trips however many
      // tag feeds there are.
      const [previous, existing] = await Promise.all([listFeeds(), deps.kv.getMany(files.map((f) => feedKey(f.path)))]);
      const changed: string[] = [];
      const writes: [string, string][] = [];
      files.forEach((file, i) => {
        const hash = sha256(file.body);
        const before = existing[i];
        if (before && (JSON.parse(before) as StoredFeed).hash === hash) return;
        const stored: StoredFeed = { ...file, hash, updatedAt: now().toISOString() };
        writes.push([feedKey(file.path), JSON.stringify(stored)]);
        changed.push(file.path);
      });
      // A feed that's no longer generated (last post with a tag unpublished) must
      // disappear, not linger with stale items.
      const current = new Set(files.map((f) => f.path));
      const removed = previous.filter((p) => !current.has(p));
      writes.push([INDEX_KEY, JSON.stringify([...current])]);
      await deps.kv.writeBatch({ set: writes, del: removed.map(feedKey) });
      changed.push(...removed.map((p) => `-${p}`));

      const outcome: EventOutcome = {
        kind: "rebuilt",
        changed,
        unchanged: files.length - changed.filter((p) => !p.startsWith("-")).length,
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

  /** Records a request rejected before the pipeline (bad auth). Never logs the credential itself. */
  async function rejected(reason: string) {
    await log({ stage: "receiver", outcome: { kind: "failed", error: `rejected: ${reason}` } });
  }

  return { receive, process, readFeed, listFeeds, recentEvents, rejected };
}

export type Pipeline = ReturnType<typeof createPipeline>;
