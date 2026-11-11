"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const SCENARIOS = [
  { id: "publish", label: "Publish an edit", hint: "New version with a changed headline: feeds update." },
  { id: "duplicate", label: "Retry the same delivery", hint: "Same version again: the dedup window drops it." },
  { id: "republish-unchanged", label: "Republish, nothing changed", hint: "New version, same bytes: worker runs, writes nothing." },
  { id: "autosave", label: "Autosave", hint: "Not a publish-state change: filtered before the queue." },
  { id: "other-type", label: "Publish an author", hint: "Content type outside the feeds: filtered." },
] as const;

export function DemoPanel() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<string>("");

  async function run(id: string, label: string) {
    const res = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: id }),
    });
    const data = (await res.json()) as { results?: { kind: string }[]; error?: string };
    setLast(data.error ? `Error: ${data.error}` : `${label}: ${data.results?.map((r) => r.kind).join(", ")}`);
    startTransition(() => router.refresh());
  }

  return (
    <section className="panel demo" aria-labelledby="demo-h">
      <h2 id="demo-h">Try it (demo mode: sample content, in-memory store)</h2>
      <div className="demo-buttons">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" disabled={pending} title={s.hint} onClick={() => run(s.id, s.label)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="detail" role="status">
        {last || "Each button sends a realistic webhook through the real receiver and worker. Watch the event log."}
      </p>
    </section>
  );
}
