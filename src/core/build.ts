import { buildJsonFeed } from "./feeds/jsonFeed";
import { buildRss } from "./feeds/rss";
import { buildNewsSitemap, buildSitemap } from "./feeds/sitemaps";
import type { Article, FeedFile, Site } from "./types";
import { slugify } from "./xml";

const RSS_LIMIT = 50;
const RSS = "application/rss+xml; charset=utf-8";
const XML = "application/xml; charset=utf-8";
const JSON_FEED = "application/feed+json; charset=utf-8";

export type Partner = {
  id: string;
  name: string;
  /** Campaign parameters on every item link, so partner traffic is attributable. */
  tracking: Record<string, string>;
  /** Some aggregators reject items without an image; drop those instead of failing the feed. */
  requireImage?: boolean;
};

export const DEFAULT_PARTNERS: Partner[] = [
  { id: "flipboard", name: "Flipboard", tracking: { utm_source: "flipboard", utm_medium: "syndication" }, requireImage: true },
  { id: "msn", name: "MSN", tracking: { utm_source: "msn", utm_medium: "syndication" }, requireImage: true },
  { id: "yahoo", name: "Yahoo", tracking: { utm_source: "yahoo", utm_medium: "syndication" } },
];

export type BuildInput = {
  site: Site;
  articles: Article[];
  now: Date;
  partners?: Partner[];
  newsMinimumArticles?: number;
};

/**
 * Pure: the same articles and clock always produce byte-identical files. That
 * property is what lets the worker skip writes by comparing content hashes.
 */
export function buildFeeds(input: BuildInput): FeedFile[] {
  const { site, now } = input;
  const base = site.wireUrl.replace(/\/$/, "");
  const self = (path: string) => `${base}/feeds/${path}`;

  // Scheduled posts (future publishedAt) stay out of every feed until their time.
  const published = input.articles
    .filter((a) => Date.parse(a.publishedAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  const latest = published.slice(0, RSS_LIMIT);

  const files: FeedFile[] = [
    { path: "rss.xml", contentType: RSS, body: buildRss({ site, articles: latest, selfUrl: self("rss.xml") }) },
    { path: "feed.json", contentType: JSON_FEED, body: buildJsonFeed(site, latest, self("feed.json")) },
    { path: "sitemap.xml", contentType: XML, body: buildSitemap(site, published) },
    {
      path: "news-sitemap.xml",
      contentType: XML,
      body: buildNewsSitemap(site, published, { now, minimumArticles: input.newsMinimumArticles }),
    },
  ];

  const tags = new Map<string, string>();
  for (const a of published) for (const t of a.tags) if (slugify(t)) tags.set(slugify(t), t);
  for (const [slug, label] of [...tags].sort(([x], [y]) => x.localeCompare(y))) {
    const path = `tags/${slug}.xml`;
    const tagged = latest.filter((a) => a.tags.some((t) => slugify(t) === slug));
    files.push({
      path,
      contentType: RSS,
      body: buildRss({ site, articles: tagged, selfUrl: self(path), title: `${site.title}: ${label}` }),
    });
  }

  for (const p of input.partners ?? DEFAULT_PARTNERS) {
    const path = `partners/${p.id}.xml`;
    const eligible = p.requireImage ? latest.filter((a) => a.image) : latest;
    files.push({
      path,
      contentType: RSS,
      body: buildRss({ site, articles: eligible, selfUrl: self(path), tracking: p.tracking }),
    });
  }

  return files;
}
