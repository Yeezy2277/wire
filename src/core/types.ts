/** An article as the feeds see it: already mapped from the CMS shape. */
export type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** ISO 8601. */
  publishedAt: string;
  /** ISO 8601. */
  updatedAt: string;
  tags: string[];
  author?: string;
  image?: { url: string; width?: number; height?: number; alt?: string };
  readingTimeMinutes?: number;
  sponsored?: boolean;
};

export type Site = {
  url: string;
  title: string;
  description: string;
  language: string;
  /** Public base URL of Wire itself, for feed self-links. */
  wireUrl: string;
};

/** One generated file: what we store and serve at `/feeds/<path>`. */
export type FeedFile = {
  path: string;
  contentType: string;
  body: string;
};

export type EntryAction = "publish" | "unpublish" | "archive" | "delete";

/** The queue message: everything the worker needs, nothing it doesn't. */
export type FeedJob = {
  entryId: string;
  action: EntryAction;
  version: number;
  receivedAt: string;
};

export type EventOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "deduped"; key: string }
  | { kind: "queued"; key: string }
  | { kind: "rebuilt"; changed: string[]; unchanged: number; ms: number }
  | { kind: "failed"; error: string };

export type EventLogEntry = {
  at: string;
  stage: "receiver" | "worker";
  entryId?: string;
  action?: string;
  outcome: EventOutcome;
};
