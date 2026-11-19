import { rawResponse } from "@/lib/http/raw";

// GET /dl/:id — the bytes, as an attachment.
//
// THE ONLY BYTE ENDPOINT. There was an inline /raw/:id beside it, and dropping it is what
// let the app ship on one domain: `Content-Disposition: attachment` means the browser saves
// rather than renders, so hostile bytes have no origin to execute in and there is nothing
// for a second registrable domain to isolate (lib/urls.ts, §6.5).
//
// Headers and the 410 receipt live in lib/http/raw.ts.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return rawResponse(id, "attachment");
}
