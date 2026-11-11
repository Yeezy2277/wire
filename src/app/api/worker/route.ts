import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyQStashSignature } from "@/adapters/queue";
import { container } from "@/server/container";

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
  const { pipeline, mode, workerUrl, signingKeys } = container();
  if (mode.queue !== "qstash") {
    return NextResponse.json({ error: "worker endpoint is only used with QStash" }, { status: 404 });
  }

  const raw = await req.text();
  const check = verifyQStashSignature({ jwt: req.headers.get("upstash-signature"), body: raw, url: workerUrl, keys: signingKeys });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

  const job = Job.safeParse(JSON.parse(raw));
  // A malformed job will never succeed; 2xx stops pointless retries.
  if (!job.success) return NextResponse.json({ error: "malformed job, dropped" }, { status: 200 });

  try {
    return NextResponse.json(await pipeline.process(job.data));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "worker failed" }, { status: 500 });
  }
}
