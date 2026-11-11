const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text for XML element content and attribute values. */
export function escapeXml(value: string): string {
  // Strip characters XML 1.0 forbids outright (C0 controls except tab/newline/CR):
  // one stray control character from a pasted CMS field invalidates the whole feed.
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return clean.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** RFC 822 date, as RSS 2.0 requires (e.g. "Wed, 11 Nov 2026 14:00:00 GMT"). */
export function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

/** Adds campaign parameters without clobbering ones already on the URL. */
export function withTracking(url: string, params: Record<string, string> | undefined): string {
  if (!params || Object.keys(params).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

/** Lowercase, ASCII-only path segment for tag feeds ("Design Systems" → "design-systems"). */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
