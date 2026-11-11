import { describe, expect, it } from "vitest";
import { dedupKey, parseContentfulEvent } from "./event";

const filter = { environment: "master", contentTypes: ["blogPost"] };
const entry = (over: Record<string, unknown> = {}) => ({
  sys: {
    id: "post-1",
    type: "Entry",
    version: 7,
    contentType: { sys: { id: "blogPost" } },
    environment: { sys: { id: "master" } },
    ...over,
  },
});

describe("parseContentfulEvent", () => {
  it("turns a publish of a feed content type into a job", () => {
    const r = parseContentfulEvent("ContentManagement.Entry.publish", entry(), filter, new Date("2026-11-12T10:00:00Z"));
    expect(r).toEqual({
      ok: true,
      job: { entryId: "post-1", action: "publish", version: 7, receivedAt: "2026-11-12T10:00:00.000Z" },
    });
  });

  it.each(["save", "auto_save", "create"])("ignores %s: it doesn't change what readers see", (action) => {
    const r = parseContentfulEvent(`ContentManagement.Entry.${action}`, entry(), filter);
    expect(r.ok).toBe(false);
  });

  it("ignores other content types and other environments", () => {
    expect(parseContentfulEvent("ContentManagement.Entry.publish", entry({ contentType: { sys: { id: "author" } } }), filter).ok).toBe(false);
    expect(parseContentfulEvent("ContentManagement.Entry.publish", entry({ environment: { sys: { id: "staging" } } }), filter).ok).toBe(false);
  });

  it("ignores asset events and garbage bodies", () => {
    expect(parseContentfulEvent("ContentManagement.Asset.publish", entry(), filter).ok).toBe(false);
    expect(parseContentfulEvent("ContentManagement.Entry.publish", { nope: true }, filter).ok).toBe(false);
    expect(parseContentfulEvent(null, entry(), filter).ok).toBe(false);
  });

  it("accepts unpublish payloads, which carry revision instead of version", () => {
    const r = parseContentfulEvent(
      "ContentManagement.Entry.unpublish",
      { sys: { id: "post-1", type: "DeletedEntry", revision: 3, contentType: { sys: { id: "blogPost" } } } },
      filter,
    );
    expect(r.ok && r.job).toMatchObject({ action: "unpublish", version: 3 });
  });
});

describe("dedupKey", () => {
  it("differs by version, so a genuine republish is never swallowed", () => {
    const base = { entryId: "e", action: "publish" as const, receivedAt: "" };
    expect(dedupKey({ ...base, version: 1 })).not.toBe(dedupKey({ ...base, version: 2 }));
    expect(dedupKey({ ...base, version: 1 })).toBe(dedupKey({ ...base, version: 1 }));
  });
});
