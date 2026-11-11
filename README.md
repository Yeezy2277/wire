# Wire

An event-driven feeds pipeline for a headless CMS. When an editor publishes in
Contentful, Wire regenerates the site's syndication feeds (RSS, JSON Feed, tag
feeds, Google News sitemap and partner feeds for Flipboard, MSN and Yahoo)
without a deploy, and without doing the same work twice.

> **Why it exists.** I built a pipeline with this shape in production for a
> French news magazine (Contentful → Cloud Run → Pub/Sub → Node worker → GCS).
> That code is under NDA, so this is a clean-room rebuild of the same design on
> free infrastructure, wired to my own Contentful blog
> ([The Lumen Review](https://lumen.vitaliipopov.dev)).

**Live:** [wire.vitaliipopov.dev](https://wire.vitaliipopov.dev) · runs with zero config in demo mode (`npm run dev`).

## Architecture

```
Contentful webhook
   │  x-webhook-secret
   ▼
Receiver  /api/webhooks/contentful     auth → filter → dedup (Redis SET NX EX) → enqueue
   │  QStash (HTTP push queue, retries, at-least-once)
   ▼
Worker    /api/worker                  verify QStash JWT → fetch published posts (CDA)
   │                                   → build all feeds → sha256 → write only changed files
   ▼
Store     Upstash Redis                feeds + content hashes + event log
   ▼
Readers   /feeds/*                     ETag / 304, CDN-cached (s-maxage=300, SWR)
```

| Production (original) | This rebuild |
|---|---|
| Cloud Run receiver | Next.js route handler on Vercel |
| Pub/Sub | Upstash QStash |
| Cloud Function / GKE worker | Next.js route handler |
| GCS bucket + CDN | Upstash Redis + Vercel edge cache |

The core (`src/core`) is framework-free and talks to the world through three
ports (`Kv`, `Queue`, `ContentSource`). Swapping Redis for GCS or QStash for
Pub/Sub is an adapter, not a rewrite.

## Three guards, one property

Content webhooks are noisy and at-least-once. Wire stays correct because:

1. **Filter at the edge.** Only `publish` / `unpublish` / `archive` / `delete`
   of feed content types in the right environment get queued. Autosaves fire
   constantly and never cost a worker run.
2. **Dedup window.** The key is `entryId:action:version`. A retried or doubled
   delivery of the same version inside 5 minutes is dropped atomically
   (`SET NX EX`); QStash's deduplication id is a second layer. A real
   republish has a new version, so it is never swallowed.
3. **Idempotent worker.** The worker doesn't patch feeds incrementally: every
   run rebuilds everything from the current published state with a pure,
   deterministic builder, hashes each file, and writes only files whose bytes
   changed. Retries, out-of-order jobs and republishes that change nothing
   (another integration touching an unrelated field) all converge to the same
   output for free.

This is the fix for the classic feedback loop: a sync job that writes back to
the CMS triggers the webhook that started it. In production that bit us; here
the guards above are the design, not a patch.

## Safety net

`/api/rebuild` runs a full rebuild directly (no queue). A daily Vercel cron
calls it (`Authorization: Bearer $CRON_SECRET`), so even if a webhook delivery
were ever lost for good, every feed converges within a day. Feeds that stop
being generated (the last post with a tag is unpublished) are deleted rather
than left stale.

## Operational details

- **One error envelope.** Every API route answers errors as
  `{ error, message, details?, requestId }` with an `x-request-id` header.
  Internal failures are logged under that id; the response never echoes the raw
  exception.
- **Two round trips per rebuild.** The worker reads every existing feed with one
  `MGET`, then writes changed files, deletions and the index in one
  `MULTI/EXEC`, so a reader never sees half a rebuild however many tag feeds
  there are.
- **Security headers** on every response: CSP (`frame-ancestors 'none'`,
  same-origin only), `nosniff`, `Referrer-Policy`, `X-Frame-Options`.

## Feeds

| Path | What |
|---|---|
| `/feeds/rss.xml` | RSS 2.0, Media RSS images, Dublin Core authors, latest 50 |
| `/feeds/feed.json` | JSON Feed 1.1 with a `_wire` extension (reading time, sponsored) |
| `/feeds/tags/<tag>.xml` | One RSS feed per tag |
| `/feeds/news-sitemap.xml` | Google News sitemap (48-hour window) |
| `/feeds/sitemap.xml` | All posts with `lastmod` |
| `/feeds/partners/<id>.xml` | Partner feeds: UTM-tagged links, canonical guids, image-required filtering |

Details that matter in real syndication: scheduled (future-dated) posts stay out
of every feed; CMS text is XML-escaped and stripped of control characters, so one
stray character can't invalidate a feed; partner links carry campaign parameters
while `guid` stays canonical so readers don't see duplicates.

## Run it

```bash
npm install
npm run dev        # demo mode: sample posts, in-memory store, inline queue
npm test           # core, routes (auth, error envelope) and DemoPanel component tests
```

The demo panel replays realistic webhook traffic (an edit, a retried delivery,
a no-op republish, an autosave, an unrelated content type) through the real
receiver and worker so you can watch each guard in the event log.

To run live, copy `.env.example` to `.env.local` and fill in Contentful
(read-only CDA token), Upstash Redis and QStash. Each missing piece falls back
to its demo stand-in independently, but a half-configured one doesn't: the env
is validated with Zod at startup, and a Contentful space without its token, a
QStash token without a signing key, or a live pipeline without
`WEBHOOK_SECRET` refuses to start and lists what's missing. Then point a Contentful webhook at
`/api/webhooks/contentful` with a custom `x-webhook-secret` header, triggered on
Entry publish, unpublish, archive and delete.

## Stack

Next.js 15 (route handlers only on the hot path), TypeScript strict, Zod at the
boundaries, Vitest, Upstash Redis + QStash over plain `fetch` (no SDKs), GitHub
Actions CI.
