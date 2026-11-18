import { rawResponse } from "@/lib/http/raw";

// GET /raw/:id — the bytes, as curl and the copy button read them.
//
// `inline` keeps curl-friendly behaviour. Headers and the 410 receipt live in
// lib/http/raw.ts, shared with /dl/:id so the two cannot drift apart.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rawResponse(id, "inline");
}
