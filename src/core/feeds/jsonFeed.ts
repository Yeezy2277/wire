import type { Article, Site } from "../types";
import { articleUrl } from "./rss";

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export function buildJsonFeed(site: Site, articles: Article[], selfUrl: string): string {
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: site.title,
    home_page_url: site.url,
    feed_url: selfUrl,
    description: site.description,
    language: site.language,
    items: articles.map((a) => {
      const url = articleUrl(site, a);
      return {
        id: url,
        url,
        title: a.title,
        summary: a.excerpt,
        date_published: a.publishedAt,
        date_modified: a.updatedAt,
        tags: a.tags,
        ...(a.image ? { image: a.image.url } : {}),
        ...(a.author ? { authors: [{ name: a.author }] } : {}),
        // Extension object: JSON Feed allows "_"-prefixed custom keys.
        _wire: {
          ...(a.readingTimeMinutes ? { reading_time_minutes: a.readingTimeMinutes } : {}),
          ...(a.sponsored ? { sponsored: true } : {}),
        },
      };
    }),
  };
  return JSON.stringify(feed, null, 2) + "\n";
}
