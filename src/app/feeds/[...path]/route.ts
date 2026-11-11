import { container, ensureBuilt } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves stored feeds with a strong ETag and CDN caching; readers never trigger a rebuild. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  await ensureBuilt();
  const path = (await params).path.join("/");
  const feed = await container().pipeline.readFeed(path);
  if (!feed) return new Response("Feed not found. It appears after the first publish event.\n", { status: 404 });

  const etag = `"${feed.hash.slice(0, 32)}"`;
  const headers = {
    "Content-Type": feed.contentType,
    ETag: etag,
    "Last-Modified": new Date(feed.updatedAt).toUTCString(),
    // Edge caches for 5 minutes and serves stale while refetching; feed readers poll a lot.
    "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(feed.body, { headers });
}
