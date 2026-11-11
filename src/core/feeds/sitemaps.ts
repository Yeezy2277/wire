import type { Article, Site } from "../types";
import { escapeXml } from "../xml";
import { articleUrl } from "./rss";

/** Google News only accepts articles from the last two days. */
export const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
const NEWS_MAX_URLS = 1000;

export type NewsSitemapOptions = {
  now: Date;
  /**
   * Keep at least this many recent articles even when they're older than the
   * window. Off (0) for real Google News submissions; useful for a low-volume
   * demo site whose news sitemap would otherwise be empty most days.
   */
  minimumArticles?: number;
};

export function selectNewsArticles(articles: Article[], opts: NewsSitemapOptions): Article[] {
  const cutoff = opts.now.getTime() - NEWS_WINDOW_MS;
  const inWindow = articles.filter((a) => Date.parse(a.publishedAt) >= cutoff);
  const floor = opts.minimumArticles ?? 0;
  const picked = inWindow.length >= floor ? inWindow : articles.slice(0, floor);
  return picked.slice(0, NEWS_MAX_URLS);
}

export function buildNewsSitemap(site: Site, articles: Article[], opts: NewsSitemapOptions): string {
  const urls = selectNewsArticles(articles, opts).map(
    (a) => `  <url>
    <loc>${escapeXml(articleUrl(site, a))}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(site.title)}</news:name>
        <news:language>${escapeXml(site.language)}</news:language>
      </news:publication>
      <news:publication_date>${a.publishedAt}</news:publication_date>
      <news:title>${escapeXml(a.title)}</news:title>
    </news:news>
  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls.join("\n")}
</urlset>
`;
}

export function buildSitemap(site: Site, articles: Article[]): string {
  const urls = articles.map(
    (a) => `  <url>
    <loc>${escapeXml(articleUrl(site, a))}</loc>
    <lastmod>${a.updatedAt}</lastmod>
  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}
