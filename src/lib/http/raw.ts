// The byte response behind /dl/:id.
//
// Every header here is load-bearing, and this is the one place in the product where getting
// a header wrong is an exploit rather than a cosmetic defect (§6.5).
//
// `Content-Disposition: attachment` IS THE SECURITY PROPERTY, not a convenience. It tells
// the browser to save these bytes rather than render them, so a paste whose body is a
// complete HTML document has no origin to execute in. §6.5 originally reached the same
// place differently — an inline /raw/:id on its own registrable domain, so that a
// content-type failure would execute somewhere without the reader's session. Removing the
// inline endpoint removed the need for the second domain: see src/lib/urls.ts.
//
// `nosniff`, the exact content type and `CSP: sandbox` all stay. They were the primary
// defence when bytes were served inline and they are free depth now.
//
// `kind` still carries "inline", used by the 404 and 410 responses below: a lapsed paste
// should show its receipt in the browser, not download a file called 410.txt.

import { noCache, rawCacheControl } from "@/lib/http/cache";
import { livenessOf, tombstoneFor } from "@/lib/expiry/tombstone";
import { RAW_CSP } from "@/lib/http/csp";
import { formatDate } from "@/lib/format";
import { getPaste, getRaw } from "@/lib/server/paste-service";
import type { Viewer } from "@/lib/types";

const ANON: Viewer = { kind: "anon" };

/**
 * RFC 5987 encoding for the download filename.
 *
 * A paste's title is attacker-supplied and is far likelier to be forgotten than its
 * body. Interpolating it raw opens header injection via CR/LF, and a non-ASCII title
 * produces an invalid header. So: a sanitised ASCII fallback for old clients plus a
 * percent-encoded UTF-8 form, which is what the RFC is for.
 */
export function contentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const ascii = filename
    // Strip anything that could terminate or re-open a header, plus quotes.
    .replaceAll(/[\r\n"\\]/g, "")
    .replaceAll(/[^\x20-\x7e]/g, "_")
    .slice(0, 100);
  const encoded = encodeURIComponent(filename).replaceAll("'", "%27");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** A sensible filename when the paste has no title: the id plus a guessed extension. */
export function filenameFor(id: string, title: string | null): string {
  if (title !== null && title.trim() !== "") return title.trim();
  return `${id}.txt`;
}

export async function rawResponse(
  id: string,
  kind: "inline" | "attachment",
): Promise<Response> {
  const paste = await getPaste(ANON, id);

  // Never existed: a genuine 404. Tombstoning an unknown id would let anyone mint a
  // receipt for a paste that never was.
  if (paste === null) {
    return new Response("Not found\n", {
      status: 404,
      headers: baseHeaders("inline", "404.txt"),
    });
  }

  const liveness = livenessOf(paste);
  if (liveness.kind === "gone") {
    const t = tombstoneFor(paste, liveness.reason);
    // A plain-text receipt, because this endpoint's readers are curl and scripts. It
    // carries the hash for the same reason the HTML tombstone does: someone with a
    // local copy can prove it is the same text.
    const body =
      `410 Gone\n` +
      `\n` +
      `This snippet is no longer available (${t.reason}).\n` +
      `  id         /p/${t.id}\n` +
      `  created    ${formatDate(t.createdAt)} by ${t.owner}\n` +
      `  size       ${t.byteSize} bytes, ${t.lineCount} lines\n` +
      `  sha256     ${t.sha256}\n` +
      (t.purgeAfter === null
        ? ""
        : `  purged     ${formatDate(t.purgeAfter)}\n`);
    return new Response(body, {
      status: 410,
      headers: {
        ...baseHeaders("inline", `${id}.txt`),
        "cache-control": noCache(),
      },
    });
  }

  const text = await getRaw(ANON, id);
  if (text === null) {
    // Live by policy but with no bytes to serve. Not a tombstone: a 410 here would be
    // a lie, and the text may be intact behind unreachable storage (§15).
    return new Response("The text is intact; storage is unreachable.\n", {
      status: 503,
      headers: baseHeaders("inline", `${id}.txt`),
    });
  }

  return new Response(text, {
    status: 200,
    headers: {
      ...baseHeaders(kind, filenameFor(id, paste.title)),
      "cache-control": rawCacheControl({ expiresAt: paste.expiresAt }),
    },
  });
}

function baseHeaders(
  kind: "inline" | "attachment",
  filename: string,
): Record<string, string> {
  return {
    // The charset is not optional: omit it and UTF-7 sniffing attacks come back.
    // Serving user content as text/html would make this a hosting provider for
    // phishing pages.
    "content-type": "text/plain; charset=utf-8",
    // Without this a browser may ignore text/plain and sniff a leading <html>.
    "x-content-type-options": "nosniff",
    "content-disposition": contentDisposition(kind, filename),
    "content-security-policy": RAW_CSP,
    // Belt to the sandbox braces: nothing here should ever be framed.
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
}
