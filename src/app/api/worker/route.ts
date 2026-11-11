import { z } from "zod";
import { verifyQStashSignature } from "@/adapters/queue";
import { container } from "@/server/container";
import { apiError, apiOk, internalError, parseJson, requestId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Job = z.object({
  entryId: z.string(),
  action: z.enum(["publish", "unpublish", "archive", "delete"]),
  version: z.number().int(),
  receivedAt: z.string(),
});

/** Worker: QStash delivers jobs here. Non-2xx makes QStash retry, so failures throw through. */
export async function POST(req: Request) {
  const rid = requestId(req);
  const { pipeline, mode, workerUrl, signingKeys } = container();
  if (mode.queue !== "qstash") {
    return apiError(rid, 404, "not_found", "The worker endpoint is only used with QStash.");
  }

  const raw = await req.text();
  const check = verifyQStashSignature({ jwt: req.headers.get("upstash-signature"), body: raw, url: workerUrl, keys: signingKeys });
  if (!check.ok) return apiError(rid, 401, "invalid_signature", `QStash signature rejected: ${check.reason}.`);

  // A malformed job will never succeed, so 2xx stops pointless retries. That
  // includes a body that isn't JSON at all: throwing here would make QStash
  // retry it forever.
  const parsed = parseJson(raw);
  const job = parsed.ok ? Job.safeParse(parsed.value) : null;
  if (!job?.success) return apiOk(rid, { dropped: true, reason: parsed.ok ? "malformed job" : "body is not JSON" });

  try {
    return apiOk(rid, await pipeline.process(job.data));
  } catch (err) {
    // Non-2xx makes QStash retry; the pipeline already logged the failure.
    return internalError(rid, "worker", err);
  }
}
