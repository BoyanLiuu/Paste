// Every user-visible number and date is formatted here, once.
//
// All dates render in **UTC**, always, and say so. This is not a shortcut — a paste's
// expiry is a fact other documents cite, so "expires 12 Dec" must mean the same thing
// to everyone reading the link. Rendering in the server's local zone would make the
// date depend on which machine answered, and these are Server Components: the browser's
// zone is not available at render time anyway. Showing a zone the reader did not choose
// is better than showing a different date to each of them.

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** "12 Dec 2026" */
export function formatDate(iso: string | number | Date): string {
  return DATE.format(new Date(iso));
}

/** "14:20 UTC" */
export function formatTime(iso: string | number | Date): string {
  return `${TIME.format(new Date(iso))} UTC`;
}

/** "12 Dec 2026, 14:20 UTC" — the metadata-panel form. */
export function formatDateTime(iso: string | number | Date): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** Sizes read down a column, so they are formatted identically everywhere. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "18,420" — line counts are compared, so they get thousands separators. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}
