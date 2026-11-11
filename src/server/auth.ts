import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison so response timing doesn't leak how much of the secret matched. */
export function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
