import { NextResponse } from "next/server";
import { z } from "zod";
import { container, ensureBuilt } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  scenario: z.enum(["publish", "duplicate", "republish-unchanged", "autosave", "other-type"]),
});

const ARTICLE = "demo-webhook-loops";
let version = 10;

const entryEvent = (id: string, v: number, contentType = "blogPost") => ({
  sys: { id, type: "Entry", version: v, contentType: { sys: { id: contentType } }, environment: { sys: { id: "master" } } },
});

/**
 * Demo mode only: replays realistic webhook traffic through the real receiver
 * and worker, so a visitor can watch each guard do its job.
 */
export async function POST(req: Request) {
  const { pipeline, mode, fixtures } = container();
  if (!mode.demo || !fixtures) return NextResponse.json({ error: "demo is disabled on the live pipeline" }, { status: 404 });
  await ensureBuilt();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });

  const publish = "ContentManagement.Entry.publish";
  const results = [];
  switch (parsed.data.scenario) {
    case "publish": {
      // An editor changes the headline and publishes: new version, feeds change.
      version += 1;
      fixtures.touch(ARTICLE, { title: `When a webhook calls itself (rev ${version})` });
      results.push(await pipeline.receive(publish, entryEvent(ARTICLE, version)));
      break;
    }
    case "duplicate": {
      // Contentful retries a delivery: the same version arrives twice.
      results.push(await pipeline.receive(publish, entryEvent(ARTICLE, version)));
      break;
    }
    case "republish-unchanged": {
      // Another integration (e.g. a reading-time webhook) republishes the entry
      // without touching anything the feeds contain: new version, same bytes.
      version += 1;
      results.push(await pipeline.receive(publish, entryEvent(ARTICLE, version)));
      break;
    }
    case "autosave": {
      results.push(await pipeline.receive("ContentManagement.Entry.auto_save", entryEvent(ARTICLE, version + 1)));
      break;
    }
    case "other-type": {
      results.push(await pipeline.receive(publish, entryEvent("demo-author", 3, "author")));
      break;
    }
  }
  return NextResponse.json({ results });
}
