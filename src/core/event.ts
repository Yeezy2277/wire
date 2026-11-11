import { z } from "zod";
import type { EntryAction, FeedJob } from "./types";

const ACTIONS: readonly EntryAction[] = ["publish", "unpublish", "archive", "delete"];

const Payload = z.object({
  sys: z.object({
    id: z.string().min(1),
    type: z.string(),
    version: z.number().int().optional(),
    revision: z.number().int().optional(),
    contentType: z.object({ sys: z.object({ id: z.string() }) }).optional(),
    environment: z.object({ sys: z.object({ id: z.string() }) }).optional(),
  }),
});

export type EventFilter = {
  environment: string;
  contentTypes: string[];
};

export type ParsedEvent = { ok: true; job: FeedJob } | { ok: false; reason: string };

/**
 * Turns a Contentful webhook (topic header + JSON body) into a queue job, or
 * says why the event doesn't concern the feeds. Every "no" here is a request
 * the worker never pays for.
 */
export function parseContentfulEvent(
  topic: string | null,
  body: unknown,
  filter: EventFilter,
  now: Date = new Date(),
): ParsedEvent {
  // e.g. "ContentManagement.Entry.publish"
  const [, kind, action] = (topic ?? "").split(".");
  if (kind !== "Entry") return { ok: false, reason: `not an entry event (${topic ?? "no topic"})` };
  if (!ACTIONS.includes(action as EntryAction)) {
    // save / auto_save / create fire on every keystroke-level edit; only
    // publish-state changes alter what readers can see.
    return { ok: false, reason: `action "${action}" doesn't change published content` };
  }

  const parsed = Payload.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "payload is not a Contentful entry" };
  const { sys } = parsed.data;

  const env = sys.environment?.sys.id;
  if (env && env !== filter.environment) return { ok: false, reason: `environment "${env}" is not "${filter.environment}"` };

  const contentType = sys.contentType?.sys.id;
  if (!contentType || !filter.contentTypes.includes(contentType)) {
    return { ok: false, reason: `content type "${contentType ?? "unknown"}" isn't part of the feeds` };
  }

  return {
    ok: true,
    job: {
      entryId: sys.id,
      action: action as EntryAction,
      version: sys.version ?? sys.revision ?? 0,
      receivedAt: now.toISOString(),
    },
  };
}

/**
 * One key per published state of an entry. Contentful retries deliveries and
 * can fire duplicates; the same (entry, action, version) inside the window
 * collapses to one job. A genuine re-publish bumps the version and passes.
 */
export const dedupKey = (job: FeedJob) => `${job.entryId}:${job.action}:v${job.version}`;
