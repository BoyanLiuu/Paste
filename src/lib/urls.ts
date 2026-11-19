// Where the bytes live.
//
// THERE IS NO INLINE RAW ENDPOINT, and this file is small because of it. `/raw/:id`
// existed to serve a paste's bytes for a browser to display, and §6.5 required a second
// registrable domain to hold it: bytes rendered inline are one content-type mistake away
// from being a page, and a page served from the app's own origin executes with the reader's
// session. That is a real failure class — `nosniff` exists because browsers got it wrong —
// and a second origin was the only remaining lever, because a raw endpoint cannot escape
// its output without ceasing to be one.
//
// What removed the problem was removing the inline endpoint. `/dl/:id` sends the same bytes
// with `Content-Disposition: attachment`, so the browser SAVES rather than renders them.
// There is no origin for a script to run in, so there is nothing for a second domain to
// isolate — and the deploy is one project with one domain.
//
// The cost, accepted: no curl-able URL, and a paste over the §6.2 truncation threshold can
// only be read in full by downloading it. The view page shows its first 500 lines with a
// banner that says so.

export function downloadUrl(id: string): string {
  return `/dl/${id}`;
}
