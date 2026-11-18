import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveLanguage } from "@/lib/detect/ladder";
import { escapeHtml } from "@/lib/render/gutter";
import { renderMode } from "@/lib/render/thresholds";

// POST /api/highlight — the create form's preview.
//
// Stateless, like /api/scan. It deliberately does NOT import Shiki: the preview shows
// the user their own text with the language the ladder resolved, and pulling a
// highlighter into a request path is the thing §6.2 spends its whole argument
// avoiding. Highlighting happens once, at save, and the preview's job is to confirm
// what the ladder decided — not to be a second renderer.

const body = z.object({
  body: z.string().max(256 * 1024),
  language: z.string().optional(),
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

  const detection = resolveLanguage(parsed.data);
  const lineCount =
    parsed.data.body === ""
      ? 0
      : parsed.data.body.replace(/\n$/, "").split("\n").length;
  const byteSize = new TextEncoder().encode(parsed.data.body).length;

  return NextResponse.json(
    {
      language: detection.language,
      languageSource: detection.source,
      mode: renderMode(byteSize, lineCount),
      lineCount,
      byteSize,
      // Escaped, never highlighted. The preview is about the decision, not the colours.
      html: escapeHtml(parsed.data.body),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
