import { secretMatches } from "@/server/auth";
import { container } from "@/server/container";
import { apiError, apiOk, internalError, requestId } from "@/server/http";

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
  const rid = requestId(req);
  const { pipeline, mode, env } = container();
  const cron = env.CRON_SECRET;
  const webhook = env.WEBHOOK_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const authorized =
    (cron && secretMatches(bearer, cron)) || (webhook && secretMatches(req.headers.get("x-webhook-secret"), webhook));
  if (!authorized && !mode.demo) {
    return apiError(rid, 401, "unauthorized", "Send the cron Bearer token or the x-webhook-secret header.");
  }

  try {
    const outcome = await pipeline.process({
      entryId: "full-rebuild",
      action: "publish",
      version: 0,
      receivedAt: new Date().toISOString(),
    });
    return apiOk(rid, outcome);
  } catch (err) {
    return internalError(rid, "rebuild", err);
  }
}

export const GET = rebuild;
export const POST = rebuild;
