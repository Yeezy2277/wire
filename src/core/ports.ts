import type { Article, FeedJob } from "./types";

/** The small slice of a key-value store the pipeline needs (Upstash Redis in prod). */
export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomic set-if-absent with expiry; true when this call created the key. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Prepend to a capped list (newest first). */
  pushCapped(key: string, value: string, max: number): Promise<void>;
  readList(key: string, count: number): Promise<string[]>;
}

/** Hands a job to the worker, at least once (QStash in prod). */
export interface Queue {
  enqueue(job: FeedJob, dedupId: string): Promise<void>;
}

/** Where published articles come from (Contentful Delivery API in prod). */
export interface ContentSource {
  listArticles(): Promise<Article[]>;
}
