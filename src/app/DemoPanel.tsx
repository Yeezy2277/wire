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

type Scenario = (typeof SCENARIOS)[number];

export type RunState =
  | { status: "idle" }
  | { status: "running"; label: string }
  | { status: "done"; label: string; outcomes: string[] }
  | { status: "error"; label: string; message: string };

type DemoResponse = { results?: { kind: string }[]; message?: string };

export function DemoPanel() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [state, setState] = useState<RunState>({ status: "idle" });
  const busy = state.status === "running" || refreshing;

  async function run(s: Scenario) {
    setState({ status: "running", label: s.label });
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: s.id }),
      });
      const data = (await res.json().catch(() => ({}))) as DemoResponse;
      if (!res.ok) {
        setState({ status: "error", label: s.label, message: data.message ?? `The server answered ${res.status}.` });
        return;
      }
      setState({ status: "done", label: s.label, outcomes: (data.results ?? []).map((r) => r.kind) });
      startTransition(() => router.refresh());
    } catch {
      setState({ status: "error", label: s.label, message: "The request didn't reach the server. Check your connection and try again." });
    }
  }

  return (
    <section className="panel demo" aria-labelledby="demo-h">
      <h2 id="demo-h">Try it (demo mode: sample content, in-memory store)</h2>
      <ul className="demo-buttons">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={busy} aria-describedby={`hint-${s.id}`} onClick={() => run(s)}>
              {s.label}
            </button>
            <span className="hint" id={`hint-${s.id}`}>
              {s.hint}
            </span>
          </li>
        ))}
      </ul>
      <Result state={state} />
    </section>
  );
}

function Result({ state }: { state: RunState }) {
  switch (state.status) {
    case "idle":
      return (
        <p className="detail" role="status">
          Each button sends a realistic webhook through the real receiver and worker. Watch the event log.
        </p>
      );
    case "running":
      return (
        <p className="detail" role="status">
          {state.label}: sending…
        </p>
      );
    case "done":
      return (
        <p className="detail" role="status">
          {state.label}: {state.outcomes.join(", ") || "no outcome"}
        </p>
      );
    case "error":
      return (
        <p className="detail error" role="alert">
          {state.label} failed. {state.message}
        </p>
      );
  }
}
