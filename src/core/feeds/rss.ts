import type { Article, Site } from "../types";
import { escapeXml, rfc822, withTracking } from "../xml";

export type RssOptions = {
  site: Site;
  articles: Article[];
  /** Absolute URL of this feed, for the atom:link self reference. */
  selfUrl: string;
  title?: string;
  description?: string;
  /** Campaign parameters appended to item links (partner feeds). */
  tracking?: Record<string, string>;
};

export const articleUrl = (site: Site, a: Article) => `${site.url.replace(/\/$/, "")}/posts/${a.slug}`;

function item(site: Site, a: Article, tracking?: Record<string, string>): string {
  const url = articleUrl(site, a);
  const lines = [
    `<title>${escapeXml(a.title)}</title>`,
    `<link>${escapeXml(withTracking(url, tracking))}</link>`,
    // The guid stays the canonical URL so readers don't see tracked duplicates.
    `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
    `<pubDate>${rfc822(a.publishedAt)}</pubDate>`,
    `<description>${escapeXml(a.excerpt)}</description>`,
  ];
  if (a.author) lines.push(`<dc:creator>${escapeXml(a.author)}</dc:creator>`);
  for (const tag of a.tags) lines.push(`<category>${escapeXml(tag)}</category>`);
  if (a.sponsored) lines.push(`<category>Sponsored</category>`);
  if (a.image) {
    const size = [
      a.image.width ? ` width="${a.image.width}"` : "",
      a.image.height ? ` height="${a.image.height}"` : "",
    ].join("");
    const alt = a.image.alt ? `<media:description>${escapeXml(a.image.alt)}</media:description>` : "";
    lines.push(`<media:content url="${escapeXml(a.image.url)}" medium="image"${size}>${alt}</media:content>`);
  }
  return `    <item>\n      ${lines.join("\n      ")}\n    </item>`;
}

/** RSS 2.0 with Atom self-link, Media RSS images and Dublin Core authors. */
export function buildRss(opts: RssOptions): string {
  const { site, articles, selfUrl, tracking } = opts;
  const lastBuild = articles[0]?.updatedAt ?? articles[0]?.publishedAt;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(opts.title ?? site.title)}</title>
    <link>${escapeXml(site.url)}</link>
    <description>${escapeXml(opts.description ?? site.description)}</description>
    <language>${escapeXml(site.language)}</language>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
${lastBuild ? `    <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>\n` : ""}${articles.map((a) => item(site, a, tracking)).join("\n")}
  </channel>
</rss>
`;
}
