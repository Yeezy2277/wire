import { describe, expect, it } from "vitest";
import { buildFeeds } from "./build";
import { selectNewsArticles } from "./feeds/sitemaps";
import type { Article, Site } from "./types";
import { escapeXml, slugify, withTracking } from "./xml";

const site: Site = {
  url: "https://lumen.example",
  title: "The Lumen Review",
  description: "Writing",
  language: "en",
  wireUrl: "https://wire.example",
};
const now = new Date("2026-11-12T12:00:00Z");
const article = (id: string, hoursAgo: number, over: Partial<Article> = {}): Article => ({
  id,
  slug: id,
  title: `Title ${id}`,
  excerpt: "Excerpt",
  publishedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  updatedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  tags: [],
  ...over,
});
const file = (files: ReturnType<typeof buildFeeds>, path: string) => files.find((f) => f.path === path)?.body ?? "";

describe("buildFeeds", () => {
  it("is deterministic: same input, byte-identical output", () => {
    const articles = [article("a", 1, { tags: ["Systems"] }), article("b", 5)];
    expect(buildFeeds({ site, articles, now })).toEqual(buildFeeds({ site, articles: [...articles].reverse(), now }));
  });

  it("orders newest first and keeps scheduled posts out", () => {
    const rss = file(buildFeeds({ site, articles: [article("old", 50), article("new", 1), article("future", -24)], now }), "rss.xml");
    expect(rss.indexOf("/posts/new")).toBeLessThan(rss.indexOf("/posts/old"));
    expect(rss).not.toContain("/posts/future");
  });

  it("escapes markup in CMS text so one quote can't break the feed", () => {
    const rss = file(buildFeeds({ site, articles: [article("a", 1, { title: `Tom & "Jerry" <b>` })], now }), "rss.xml");
    expect(rss).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
  });

  it("creates one feed per tag, with a stable ASCII path", () => {
    const files = buildFeeds({ site, articles: [article("a", 1, { tags: ["Design Systems", "Café"] })], now });
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(["tags/design-systems.xml", "tags/cafe.xml"]));
  });

  it("tracks partner links but keeps the canonical guid, and drops imageless items where required", () => {
    const files = buildFeeds({
      site,
      articles: [article("with-img", 1, { image: { url: "https://img/x.jpg", width: 10, height: 5 } }), article("no-img", 2)],
      now,
      partners: [{ id: "flip", name: "Flip", tracking: { utm_source: "flip" }, requireImage: true }],
    });
    const partner = file(files, "partners/flip.xml");
    expect(partner).toContain("<link>https://lumen.example/posts/with-img?utm_source=flip</link>");
    expect(partner).toContain('<guid isPermaLink="true">https://lumen.example/posts/with-img</guid>');
    expect(partner).toContain('width="10" height="5"');
    expect(partner).not.toContain("no-img");
  });

  it("emits valid JSON Feed 1.1", () => {
    const json = JSON.parse(file(buildFeeds({ site, articles: [article("a", 1, { author: "V" })], now }), "feed.json"));
    expect(json.version).toBe("https://jsonfeed.org/version/1.1");
    expect(json.items[0]).toMatchObject({ id: "https://lumen.example/posts/a", authors: [{ name: "V" }] });
  });
});

describe("Google News window", () => {
  const articles = [article("fresh", 3), article("day-old", 30), article("stale", 72)];

  it("keeps only the last 48 hours by default", () => {
    expect(selectNewsArticles(articles, { now }).map((a) => a.id)).toEqual(["fresh", "day-old"]);
  });

  it("falls back to the newest N when a quiet site would otherwise be empty", () => {
    expect(selectNewsArticles([article("stale", 72)], { now, minimumArticles: 1 }).map((a) => a.id)).toEqual(["stale"]);
  });
});

describe("xml helpers", () => {
  it("strips control characters XML forbids", () => {
    expect(escapeXml("a\u0001b")).toBe("ab");
  });
  it("adds tracking without clobbering existing params", () => {
    expect(withTracking("https://x.io/p?utm_source=keep", { utm_source: "new", utm_medium: "m" })).toBe(
      "https://x.io/p?utm_source=keep&utm_medium=m",
    );
  });
  it("slugifies accents and spaces", () => {
    expect(slugify("  Résumé Tips ")).toBe("resume-tips");
  });
});
