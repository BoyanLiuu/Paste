import { rawResponse } from "@/lib/http/raw";

// GET /dl/:id — the same bytes as an attachment.
//
// The only difference from /raw/:id is Content-Disposition, which is why both go
// through one implementation: a header that differs between them by accident is the
// kind of thing nobody notices until it matters.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rawResponse(id, "attachment");
}
