import type { Kv } from "@/core/ports";

/** In-process store for demo mode and tests. State lives as long as the server process. */
export class MemoryKv implements Kv {
  private values = new Map<string, { value: string; expiresAt?: number }>();
  private lists = new Map<string, string[]>();

  constructor(private clock: () => number = Date.now) {}

  async get(key: string) {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expiresAt !== undefined && hit.expiresAt <= this.clock()) {
      this.values.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string) {
    this.values.set(key, { value });
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    if ((await this.get(key)) !== null) return false;
    this.values.set(key, { value, expiresAt: this.clock() + ttlSeconds * 1000 });
    return true;
  }

  async pushCapped(key: string, value: string, max: number) {
    const list = [value, ...(this.lists.get(key) ?? [])].slice(0, max);
    this.lists.set(key, list);
  }

  async readList(key: string, count: number) {
    return (this.lists.get(key) ?? []).slice(0, count);
  }
}

/** Upstash Redis over its REST API: no TCP connection, so it works from serverless functions. */
export class UpstashKv implements Kv {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const data = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || data.error) throw new Error(`Upstash ${args[0]} failed: ${data.error ?? res.status}`);
    return data.result as T;
  }

  async get(key: string) {
    return this.command<string | null>("GET", key);
  }

  async set(key: string, value: string) {
    await this.command("SET", key, value);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number) {
    // SET NX EX is atomic: two concurrent deliveries can't both win.
    return (await this.command<string | null>("SET", key, value, "NX", "EX", ttlSeconds)) === "OK";
  }

  async pushCapped(key: string, value: string, max: number) {
    await this.command("LPUSH", key, value);
    await this.command("LTRIM", key, 0, max - 1);
  }

  async readList(key: string, count: number) {
    return this.command<string[]>("LRANGE", key, 0, count - 1);
  }
}
