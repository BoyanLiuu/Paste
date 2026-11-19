// POST /api/pastes — the create endpoint, implementing the nine ordered stages in
// ARCHITECTURE §4. The order is the design; see create-paste.ts for why.
//
// A Route Handler rather than a Server Action because it has a non-browser caller by
// design: the form and `curl` post to the same place (§3). Two content types, one
// pipeline — JSON from the form, a raw body from `curl --data-binary`.

import { NextResponse } from "next/server";
import { flattenError } from "zod";

import { decodeUtf8 } from "@/lib/normalise";
import { MAX_BYTES } from "@/lib/render/thresholds";
import { formatBytes } from "@/lib/format";
import { createPasteSchema } from "@/lib/schema/create-paste";
import { BlockedBySecretScan, NeedsOverride } from "@/lib/server/create-paste";
import { createPaste } from "@/lib/server/mutations";
import { charge } from "@/lib/server/rate";
import { userIdFor } from "@/lib/server/users";
import { getViewer } from "@/lib/server/session";
import { NotPermittedError } from "@/lib/server/viewer";
import type { Viewer } from "@/lib/types";

/** The bare URL for `Accept: text/plain`, which is what `$(…)` captures. */
function plainUrl(request: Request, id: string): string {
  return new URL(`/p/${id}`, request.url).toString();
}

function wantsPlainText(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  // `*/*` is curl's default and means "whatever you have" — JSON is the better answer
  // for a client that did not ask. Only an explicit text/plain gets the bare URL.
  return accept.includes("text/plain");
}

export async function POST(request: Request) {
  // --- stage 1: identify
  const viewer: Viewer = await getViewer();
  if (viewer.kind !== "user") {
    // M10 fills in the DENIED table and this becomes reachable. Written now so the
    // contract is the final one rather than something auth has to retrofit.
    return NextResponse.json(
      { error: "Sign in to create a paste." },
      { status: 401 },
    );
  }

  const ownerId = await userIdFor(viewer);
  const via = createdVia(request);

  // --- stage 2: charge the rate limit, committed, before any work
  //
  // Before the size gate and the scan on purpose: those are the expensive stages, and a
  // refusal that costs nothing lets the scanner be used as a free oracle (§6.1).
  const rate = await charge(ownerId);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error:
          rate.limit === "day"
            ? "That is today's limit. Try again tomorrow."
            : "Too many pastes in the last minute.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfter),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // --- stage 3: gate the size, on the header AND on the real byte count
  //
  // One ceiling for every caller. It used to be 10 MB for the form and 25 MB for the CLI,
  // selected by a user-agent string — so the same endpoint accepted or refused the same
  // body depending on a header the caller writes, which is a limit anyone can raise.
  const claimed = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(claimed) && claimed > MAX_BYTES) {
    // Refuse before reading the stream: the point of checking the header is to avoid
    // buffering 200 MB only to reject it.
    return tooLarge(claimed, MAX_BYTES, rate.remaining);
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BYTES) {
    // The header is a claim, so the real count is checked too. A client that understates
    // Content-Length gets refused here instead of slipping past stage 3.
    return tooLarge(raw.byteLength, MAX_BYTES, rate.remaining);
  }

  const input = await readInput(request, raw);
  if ("error" in input) {
    return NextResponse.json(input.error, {
      status: input.status,
      headers: remainingHeader(rate.remaining),
    });
  }

  // --- stages 4-8 are createPaste: normalise, resolve, scan, write, render
  try {
    const paste = await createPaste(viewer, {
      ...input.value,
      createdVia: via,
    });

    if (wantsPlainText(request)) {
      // Exactly one newline-terminated line and nothing else. No banner, no trailing
      // blank, no JSON — a stray character here breaks every shell pipeline that does
      // `url=$(curl …)`, and the breakage looks like the server being wrong.
      return new Response(`${plainUrl(request, paste.id)}\n`, {
        status: 201,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Location: `/p/${paste.id}`,
          ...remainingHeader(rate.remaining),
        },
      });
    }

    return NextResponse.json(
      {
        id: paste.id,
        url: plainUrl(request, paste.id),
        language: paste.language,
        languageSource: paste.languageSource,
        byteSize: paste.byteSize,
        lineCount: paste.lineCount,
        expiresAt: paste.expiresAt,
      },
      {
        status: 201,
        headers: {
          Location: `/p/${paste.id}`,
          ...remainingHeader(rate.remaining),
        },
      },
    );
  } catch (error) {
    // --- stage 6's two refusals. Neither wrote a paste row.
    if (error instanceof BlockedBySecretScan) {
      return NextResponse.json(
        {
          error:
            "That looks like a live credential. Nothing was saved, so this text has no URL.",
          blocked: true,
          // Offsets and previews, never the matched text (§6.1). The form uses these to
          // offer redaction, which is why they are returned at all.
          findings: error.findings.filter((f) => f.tier === 1),
          scanState: error.scanState,
        },
        { status: 422, headers: remainingHeader(rate.remaining) },
      );
    }

    if (error instanceof NeedsOverride) {
      return NextResponse.json(
        {
          error:
            "This might contain a secret. Redact it, or say why it is safe.",
          needsOverride: true,
          findings: error.findings,
          scanState: error.scanState,
        },
        { status: 422, headers: remainingHeader(rate.remaining) },
      );
    }

    if (error instanceof NotPermittedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    throw error;
  }
}

/**
 * Which caller this is. Recorded on the paste and shown as "Made with".
 *
 * It no longer decides the size ceiling, and it no longer sniffs the user agent for a
 * `paste-cli` string. Both were in service of a command-line client that is not being
 * built, and the sniff was the worse of the two: a self-reported header deciding a limit
 * is a limit anyone can raise by claiming to be something else.
 *
 * The distinction that remains is honest and observable — the form sends JSON, anything
 * else sends a raw body — and it is only used for display.
 */
function createdVia(request: Request): "web" | "api" {
  const type = request.headers.get("content-type") ?? "";
  return type.includes("application/json") ? "web" : "api";
}

function remainingHeader(remaining: number): Record<string, string> {
  return { "X-RateLimit-Remaining": String(remaining) };
}

function tooLarge(bytes: number, ceiling: number, remaining: number) {
  return NextResponse.json(
    {
      // Name both figures. "Too large" leaves the caller guessing how much to cut, and a
      // test once asserted on a message where the two happened to be equal.
      error: `That is ${formatBytes(bytes)}. The limit is ${formatBytes(
        ceiling,
      )} — this is a file, not a snippet.`,
    },
    { status: 413, headers: remainingHeader(remaining) },
  );
}

type ReadResult =
  | { value: Record<string, unknown> & { body: string } }
  | { error: Record<string, unknown>; status: number };

/**
 * One input shape from two content types.
 *
 * JSON goes through the same Zod schema the form uses — two callers, one definition, so
 * the browser's validation cannot drift from the server's. A raw body has no envelope to
 * validate, so its options arrive as query parameters and the body is the whole payload.
 */
async function readInput(
  request: Request,
  raw: Uint8Array,
): Promise<ReadResult> {
  const text = decodeUtf8(raw);
  if (text === null) {
    return {
      status: 415,
      error: {
        error:
          "That is not valid UTF-8. Paste holds text; a binary file has nothing to show.",
      },
    };
  }

  const type = request.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { status: 400, error: { error: "Expected a JSON body." } };
    }

    const parsed = createPasteSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        status: 422,
        error: {
          error: "That paste is not valid.",
          // Flattened to field -> messages, the shape the form reads back.
          fields: flattenError(parsed.error).fieldErrors,
        },
      };
    }
    return { value: parsed.data };
  }

  // The raw path. Options ride on the query string, which is what `curl` can express
  // without building JSON around a file.
  const params = new URL(request.url).searchParams;
  if (text === "") {
    return { status: 422, error: { error: "Nothing to save yet." } };
  }

  return {
    value: {
      body: text,
      title: params.get("title") ?? undefined,
      language: params.get("language") ?? undefined,
      filename: params.get("filename") ?? undefined,
      lineNumbers: params.get("lineNumbers") === "true",
      retention: (params.get("retention") ?? undefined) as never,
      neverReason: params.get("neverReason") ?? undefined,
    },
  };
}
