import type { ContentSource } from "@/core/ports";
import type { Article } from "@/core/types";

type Link = { sys: { id: string; type: "Link"; linkType: "Asset" | "Entry" } };
type Entry = {
  sys: { id: string; createdAt: string; updatedAt: string; contentType: { sys: { id: string } } };
  fields: Record<string, unknown>;
};
type Asset = {
  sys: { id: string };
  fields: { title?: string; description?: string; file?: { url: string; details?: { image?: { width: number; height: number } } } };
};
type EntriesResponse = {
  items: Entry[];
  includes?: { Asset?: Asset[]; Entry?: Entry[] };
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Maps one Lumen `blogPost` (plus its linked author and cover asset) to the feed shape. */
export function mapEntry(entry: Entry, assets: Map<string, Asset>, entries: Map<string, Entry>): Article | null {
  const f = entry.fields;
  const title = str(f.title);
  const slug = str(f.slug);
  if (!title || !slug) return null; // unpublishable for a feed; skip rather than emit a broken item

  const cover = f.coverImage as Link | undefined;
  const asset = cover ? assets.get(cover.sys.id) : undefined;
  const file = asset?.fields.file;
  const authorLink = f.author as Link | undefined;
  const author = authorLink ? str(entries.get(authorLink.sys.id)?.fields.name) : undefined;

  return {
    id: entry.sys.id,
    slug,
    title,
    excerpt: str(f.excerpt) ?? "",
    publishedAt: new Date(str(f.publishedDate) ?? entry.sys.createdAt).toISOString(),
    updatedAt: new Date(entry.sys.updatedAt).toISOString(),
    tags: Array.isArray(f.tags) ? f.tags.filter((t): t is string => typeof t === "string") : [],
    ...(author ? { author } : {}),
    ...(file
      ? {
          image: {
            url: file.url.startsWith("//") ? `https:${file.url}` : file.url,
            width: file.details?.image?.width,
            height: file.details?.image?.height,
            alt: asset?.fields.description || asset?.fields.title,
          },
        }
      : {}),
    ...(typeof f.estimatedReadingTime === "number" ? { readingTimeMinutes: f.estimatedReadingTime } : {}),
    ...(f.isSponsored === true ? { sponsored: true } : {}),
  };
}

/** Reads published posts from the Content Delivery API (only published content is visible there). */
export class ContentfulSource implements ContentSource {
  constructor(
    private spaceId: string,
    private environment: string,
    private accessToken: string,
    private contentType = "blogPost",
  ) {}

  async listArticles(): Promise<Article[]> {
    const url = new URL(`https://cdn.contentful.com/spaces/${this.spaceId}/environments/${this.environment}/entries`);
    url.searchParams.set("content_type", this.contentType);
    url.searchParams.set("order", "-fields.publishedDate");
    url.searchParams.set("limit", "200");
    url.searchParams.set("include", "1");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Contentful CDA ${res.status}`);
    const data = (await res.json()) as EntriesResponse;
    const assets = new Map((data.includes?.Asset ?? []).map((a) => [a.sys.id, a]));
    const entries = new Map((data.includes?.Entry ?? []).map((e) => [e.sys.id, e]));
    return data.items.map((e) => mapEntry(e, assets, entries)).filter((a): a is Article => a !== null);
  }
}
