import { container } from "@/server/container";
import { secretMatches } from "@/server/auth";
import { apiError, apiOk, internalError, requestId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receiver: authenticate, filter, dedup, enqueue, ack. No feed work happens here. */
export async function POST(req: Request) {
  const rid = requestId(req);
  const { pipeline, mode, env } = container();
  const secret = env.WEBHOOK_SECRET;

  if (secret) {
    if (!secretMatches(req.headers.get("x-webhook-secret"), secret)) {
      const given = req.headers.get("x-webhook-secret");
      await pipeline.rejected(given ? "x-webhook-secret doesn't match" : "x-webhook-secret header missing").catch(() => undefined);
      return apiError(rid, 401, "unauthorized", "The x-webhook-secret header is missing or wrong.");
    }
  } else if (!mode.demo) {
    // Never run a live pipeline with an open webhook (env validation also refuses this at startup).
    return apiError(rid, 500, "misconfigured", "WEBHOOK_SECRET is not configured on the live pipeline.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(rid, 400, "invalid_body", "The webhook body must be JSON.");
  }

  try {
    const outcome = await pipeline.receive(req.headers.get("x-contentful-topic"), body);
    // 200 even for ignored/deduped events: they were handled, so Contentful must not retry them.
    return apiOk(rid, outcome);
  } catch (err) {
    // A failed enqueue is the one case we want Contentful to retry.
    return internalError(rid, "receiver", err, 503);
  }
}
