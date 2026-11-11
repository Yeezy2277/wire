import { container, ensureBuilt } from "@/server/container";
import type { EventLogEntry } from "@/core/types";
import { DemoPanel } from "./DemoPanel";

export const dynamic = "force-dynamic";

function describe(e: EventLogEntry): string {
  const o = e.outcome;
  switch (o.kind) {
    case "ignored":
      return o.reason;
    case "deduped":
      return `already seen ${o.key} in the last 5 min`;
    case "queued":
      return `job ${o.key} handed to the worker`;
    case "rebuilt":
      return o.changed.length
        ? `${o.changed.length} file(s) changed (${o.changed.slice(0, 3).join(", ")}${o.changed.length > 3 ? "…" : ""}), ${o.unchanged} untouched · ${o.ms} ms`
        : `nothing changed, ${o.unchanged} files left as they were · ${o.ms} ms`;
    case "failed":
      return o.error;
  }
}

export default async function Home() {
  await ensureBuilt();
  const { pipeline, mode } = container();
  const [feeds, events] = await Promise.all([pipeline.listFeeds(), pipeline.recentEvents(25)]);

  return (
    <main>
      <header>
        <h1>Wire</h1>
        <p className="lede">
          An event-driven feeds pipeline for a headless CMS. A rebuild of the shape of a production system I built for a
          news publisher: content changes in Contentful fan out into RSS, JSON Feed, Google News and partner feeds without
          anyone touching a deploy.
        </p>
        <div className="badges">
          <span className={`badge ${mode.store === "upstash" ? "live" : ""}`}>store: {mode.store}</span>
          <span className={`badge ${mode.queue === "qstash" ? "live" : ""}`}>queue: {mode.queue}</span>
          <span className={`badge ${mode.content === "contentful" ? "live" : ""}`}>content: {mode.content}</span>
        </div>
      </header>

      <section className="panel" aria-labelledby="flow-h">
        <h2 id="flow-h">Pipeline</h2>
        <div className="flow">
          <span className="step">Contentful webhook</span><span className="arrow">→</span>
          <span className="step">receiver: auth · filter · dedup</span><span className="arrow">→</span>
          <span className="step">queue (at-least-once)</span><span className="arrow">→</span>
          <span className="step">worker: rebuild · hash · write changed</span><span className="arrow">→</span>
          <span className="step">/feeds/*</span>
        </div>
        <ul className="guards">
          <li><b>Filter at the edge.</b> Autosaves, other content types and other environments never reach the queue.</li>
          <li><b>Dedup window.</b> The same entry, action and version within 5 minutes collapses to one job (retries, double deliveries).</li>
          <li><b>Idempotent worker.</b> Every run rebuilds from current state and writes only files whose bytes changed, so retries and republishes are free.</li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="feeds-h">
        <h2 id="feeds-h">Feeds ({feeds.length})</h2>
        {feeds.length ? (
          <div className="feeds">
            {feeds.map((f) => (
              <a key={f} href={`/feeds/${f}`}>/feeds/{f}</a>
            ))}
          </div>
        ) : (
          <p className="empty">No feeds yet. They're generated on the first publish event.</p>
        )}
      </section>

      {mode.demo && <DemoPanel />}

      <section className="panel" aria-labelledby="log-h">
        <h2 id="log-h">Recent events</h2>
        {events.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When (UTC)</th><th>Stage</th><th>Entry</th><th>Outcome</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td className="when">{e.at.slice(11, 19)}</td>
                    <td>{e.stage}</td>
                    <td className="mono">{e.entryId ? `${e.entryId}${e.action ? ` · ${e.action}` : ""}` : "—"}</td>
                    <td><span className={`pill ${e.outcome.kind}`}>{e.outcome.kind}</span></td>
                    <td className="detail">{describe(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No events yet.</p>
        )}
      </section>

      <footer>
        Source: <a href="https://github.com/Yeezy2277/wire">github.com/Yeezy2277/wire</a> · Feeds for{" "}
        <a href="https://lumen.vitaliipopov.dev">The Lumen Review</a>
      </footer>
    </main>
  );
}
