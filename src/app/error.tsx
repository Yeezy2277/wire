"use client";

/** The page reads the feed store and event log; if either is down, say so and offer a retry. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="wrap">
      <section className="panel" role="alert">
        <h1>Wire couldn&apos;t load</h1>
        <p className="lede">
          The feed store or the event log didn&apos;t answer. Feeds already published keep being served from the edge
          cache. Try again in a moment.
        </p>
        {error.digest && <p className="detail mono">reference {error.digest}</p>}
        <p>
          <button type="button" onClick={reset}>
            Retry
          </button>
        </p>
      </section>
    </main>
  );
}
