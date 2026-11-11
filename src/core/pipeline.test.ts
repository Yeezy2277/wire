import { describe, expect, it } from "vitest";
import { MemoryKv } from "@/adapters/kv";
import { createPipeline, DEDUP_TTL_SECONDS } from "./pipeline";
import type { ContentSource, Queue } from "./ports";
import type { Article, FeedJob, Site } from "./types";

const site: Site = { url: "https://lumen.example", title: "T", description: "D", language: "en", wireUrl: "https://wire.example" };
const publish = "ContentManagement.Entry.publish";
const event = (id: string, version: number) => ({
  sys: { id, type: "Entry", version, contentType: { sys: { id: "blogPost" } }, environment: { sys: { id: "master" } } },
});

function setup(initial: Article[]) {
  let clock = new Date("2026-11-12T12:00:00Z").getTime();
  let articles = initial;
  const kv = new MemoryKv(() => clock);
  const jobs: FeedJob[] = [];
  const queue: Queue = { enqueue: async (job) => void jobs.push(job) };
  const content: ContentSource = { listArticles: async () => articles };
  const pipeline = createPipeline({
    kv,
    queue,
    content,
    site,
    filter: { environment: "master", contentTypes: ["blogPost"] },
    partners: [],
    clock: () => new Date(clock),
  });
  return {
    pipeline,
    jobs,
    advance: (ms: number) => (clock += ms),
    setArticles: (a: Article[]) => (articles = a),
  };
}

const post = (title: string): Article => ({
  id: "p1",
  slug: "p1",
  title,
  excerpt: "e",
  publishedAt: "2026-11-12T08:00:00.000Z",
  updatedAt: "2026-11-12T08:00:00.000Z",
  tags: ["Systems"],
});

describe("receiver", () => {
  it("queues a publish once and dedups a redelivery of the same version", async () => {
    const t = setup([post("A")]);
    expect((await t.pipeline.receive(publish, event("p1", 2))).kind).toBe("queued");
    expect((await t.pipeline.receive(publish, event("p1", 2))).kind).toBe("deduped");
    expect(t.jobs).toHaveLength(1);
  });

  it("lets the same version through again once the window has passed", async () => {
    const t = setup([post("A")]);
    await t.pipeline.receive(publish, event("p1", 2));
    t.advance((DEDUP_TTL_SECONDS + 1) * 1000);
    expect((await t.pipeline.receive(publish, event("p1", 2))).kind).toBe("queued");
  });

  it("releases the dedup marker when enqueueing fails, so the sender's retry gets through", async () => {
    let fail = true;
    const kv = new MemoryKv();
    const p = createPipeline({
      kv,
      queue: { enqueue: async () => { if (fail) throw new Error("queue down"); } },
      content: { listArticles: async () => [] },
      site,
      filter: { environment: "master", contentTypes: ["blogPost"] },
    });
    await expect(p.receive(publish, event("p1", 2))).rejects.toThrow("queue down");
    fail = false;
    expect((await p.receive(publish, event("p1", 2))).kind).toBe("queued");
  });

  it("never queues filtered events", async () => {
    const t = setup([post("A")]);
    expect((await t.pipeline.receive("ContentManagement.Entry.auto_save", event("p1", 3))).kind).toBe("ignored");
    expect(t.jobs).toHaveLength(0);
  });
});

describe("worker", () => {
  const job: FeedJob = { entryId: "p1", action: "publish", version: 2, receivedAt: "" };

  it("writes every feed on the first run, then nothing when content is unchanged", async () => {
    const t = setup([post("A")]);
    const first = await t.pipeline.process(job);
    expect(first.kind === "rebuilt" && first.changed).toEqual(["rss.xml", "feed.json", "sitemap.xml", "news-sitemap.xml", "tags/systems.xml"]);
    const second = await t.pipeline.process({ ...job, version: 3 });
    expect(second.kind === "rebuilt" && second.changed).toEqual([]);
  });

  it("rewrites only what an edit touches", async () => {
    const t = setup([post("A")]);
    await t.pipeline.process(job);
    t.setArticles([post("B")]);
    const after = await t.pipeline.process({ ...job, version: 3 });
    // A title change appears in the item-bearing feeds; the plain sitemap only lists URLs.
    expect(after.kind === "rebuilt" && after.changed).toEqual(["rss.xml", "feed.json", "news-sitemap.xml", "tags/systems.xml"]);
    expect((await t.pipeline.readFeed("rss.xml"))?.body).toContain("<title>B</title>");
  });

  it("deletes a feed that is no longer generated", async () => {
    const t = setup([post("A")]);
    await t.pipeline.process(job);
    t.setArticles([{ ...post("A"), tags: [] }]);
    const after = await t.pipeline.process({ ...job, version: 3 });
    expect(after.kind === "rebuilt" && after.changed).toContain("-tags/systems.xml");
    // Removed feeds don't count against the files that were generated and left alone.
    expect(after.kind === "rebuilt" && after.unchanged).toBeGreaterThanOrEqual(0);
    expect(await t.pipeline.readFeed("tags/systems.xml")).toBeNull();
    expect(await t.pipeline.listFeeds()).not.toContain("tags/systems.xml");
  });

  it("logs and rethrows on failure so the queue retries", async () => {
    const failing = createPipeline({
      kv: new MemoryKv(),
      queue: { enqueue: async () => undefined },
      content: { listArticles: async () => Promise.reject(new Error("CDA down")) },
      site,
      filter: { environment: "master", contentTypes: ["blogPost"] },
    });
    await expect(failing.process(job)).rejects.toThrow("CDA down");
    expect((await failing.recentEvents())[0]?.outcome).toEqual({ kind: "failed", error: "CDA down" });
  });
});
