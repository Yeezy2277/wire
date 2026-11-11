import type { ContentSource } from "@/core/ports";
import type { Article } from "@/core/types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** A small, realistic sample so demo mode shows full feeds with zero setup. */
export function sampleArticles(): Article[] {
  return [
    {
      id: "demo-webhook-loops",
      slug: "webhook-loops",
      title: "When a webhook calls itself: idempotency in content pipelines",
      excerpt: "A sync job that writes back to the CMS triggers the webhook that started it. Three guards that break the loop.",
      publishedAt: hoursAgo(5),
      updatedAt: hoursAgo(5),
      tags: ["Systems", "Webhooks"],
      author: "Vitalii Popov",
      image: { url: "https://images.ctfassets.net/demo/webhook-loops.jpg", width: 1600, height: 900, alt: "Arrows forming a loop" },
      readingTimeMinutes: 7,
    },
    {
      id: "demo-utc-edges",
      slug: "utc-at-the-edges",
      title: "Store in UTC, convert at the edges",
      excerpt: "Reports that disagree near midnight usually mean someone converted time zones twice.",
      publishedAt: hoursAgo(30),
      updatedAt: hoursAgo(20),
      tags: ["Systems", "Time"],
      author: "Vitalii Popov",
      readingTimeMinutes: 5,
    },
    {
      id: "demo-fsd",
      slug: "feature-sliced-without-a-rewrite",
      title: "Feature-Sliced Design without a rewrite",
      excerpt: "Moving a four-year-old frontend to a shared structure, one touched module at a time.",
      publishedAt: hoursAgo(24 * 9),
      updatedAt: hoursAgo(24 * 9),
      tags: ["Frontend", "Architecture"],
      author: "Vitalii Popov",
      image: { url: "https://images.ctfassets.net/demo/fsd.jpg", width: 1600, height: 900, alt: "Layered blocks" },
      readingTimeMinutes: 9,
      sponsored: false,
    },
    {
      id: "demo-scheduled",
      slug: "coming-soon",
      title: "Scheduled post (not in any feed until its date)",
      excerpt: "Future-dated posts stay out of every feed.",
      publishedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      updatedAt: hoursAgo(1),
      tags: ["Frontend"],
    },
  ];
}

/** Demo source: the sample, plus any edits made through the demo panel. */
export class FixtureSource implements ContentSource {
  constructor(private articles: Article[] = sampleArticles()) {}

  async listArticles() {
    return this.articles.map((a) => ({ ...a }));
  }

  /** Simulates an editor changing a post (used by the demo endpoint). */
  touch(id: string, patch: Partial<Article>) {
    this.articles = this.articles.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a));
  }

  ids() {
    return this.articles.map((a) => a.id);
  }
}
