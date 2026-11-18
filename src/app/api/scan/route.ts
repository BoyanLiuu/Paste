import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveLanguage } from "@/lib/detect/ladder";
import { scan } from "@/lib/secrets/scan";

// POST /api/scan — scan without saving.
//
// Stateless by design: text in, findings out, nothing persisted. That is what lets the
// whole blocked-create experience exist before there is a database, and it is why this
// route predates the create path (Appendix C).
//
// It runs the same scanner the create path runs. A second, lighter implementation for
// the live indicator would be a different answer from the one that refuses the save.

const body = z.object({
  body: z.string().max(1024 * 1024, "Send the first megabyte at most."),
  filename: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Expected { body: string }." },
      { status: 400 },
    );
  }

  const result = scan(parsed.data.body);
  const detection = resolveLanguage({
    body: parsed.data.body,
    filename: parsed.data.filename,
  });

  return NextResponse.json(
    {
      findings: result.findings,
      state: result.state,
      linesScanned: result.linesScanned,
      elapsedMs: Math.round(result.elapsedMs),
      language: detection.language,
      languageSource: detection.source,
    },
    // Nothing is stored, so nothing is cacheable: the answer depends entirely on the
    // body that was posted.
    { headers: { "cache-control": "no-store" } },
  );
}
