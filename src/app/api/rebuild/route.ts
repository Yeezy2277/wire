import { NextResponse } from "next/server";
import { secretMatches } from "@/server/auth";
import { container } from "@/server/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full rebuild, bypassing the queue. Used for the initial build after going
 * live and by a daily Vercel cron as a safety net: if a webhook was ever lost,
 * the feeds still converge within a day.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`; a manual call
 * can use the webhook secret header instead.
 */
async function rebuild(req: Request) {
  const { pipeline, mode } = container();
  const cron = process.env.CRON_SECRET?.trim();
  const webhook = process.env.WEBHOOK_SECRET?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const authorized =
    (cron && secretMatches(bearer, cron)) || (webhook && secretMatches(req.headers.get("x-webhook-secret"), webhook));
  if (!authorized && !mode.demo) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const outcome = await pipeline.process({
      entryId: "full-rebuild",
      action: "publish",
      version: 0,
      receivedAt: new Date().toISOString(),
    });
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "rebuild failed" }, { status: 500 });
  }
}

export const GET = rebuild;
export const POST = rebuild;
