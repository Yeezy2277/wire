import { NextResponse } from "next/server";
import { container } from "@/server/container";
import { secretMatches } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receiver: authenticate, filter, dedup, enqueue, ack. No feed work happens here. */
export async function POST(req: Request) {
  const { pipeline, mode } = container();
  const secret = process.env.WEBHOOK_SECRET?.trim();

  if (secret) {
    if (!secretMatches(req.headers.get("x-webhook-secret"), secret)) {
      return NextResponse.json({ error: "invalid webhook secret" }, { status: 401 });
    }
  } else if (!mode.demo) {
    // Never run a live pipeline with an open webhook.
    return NextResponse.json({ error: "WEBHOOK_SECRET is not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  try {
    const outcome = await pipeline.receive(req.headers.get("x-contentful-topic"), body);
    // 200 even for ignored/deduped events: they were handled, so Contentful must not retry them.
    return NextResponse.json(outcome);
  } catch (err) {
    // A failed enqueue is the one case we want Contentful to retry.
    return NextResponse.json({ error: err instanceof Error ? err.message : "receiver failed" }, { status: 503 });
  }
}
