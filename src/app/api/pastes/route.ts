// POST /api/pastes — the create endpoint.
//
// A Route Handler rather than a Server Action because it has a non-browser caller by
// design: the form and `curl` post to the same place (§3). That is also why it exists
// from M2 instead of M7. The form needs somewhere real to submit, and a Server Action
// used only until the route arrives would be a second implementation of the browser
// path — exactly what sharing the Zod schema is meant to avoid.
//
// In the static phase it validates and then refuses. M7 replaces the refusal with the
// nine ordered stages in §4; the request shape, the validation and the caller do not
// change.

import { NextResponse } from "next/server";
import { flattenError } from "zod";

import { createPasteSchema } from "@/lib/schema/create-paste";
import {
  createPaste,
  NotImplementedInStaticPhase,
} from "@/lib/server/mutations";
import { getViewer } from "@/lib/server/viewer";

export async function POST(request: Request) {
  const viewer = await getViewer();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  // The same schema the form uses. Validating here is not belt-and-braces: a client is
  // only ever making a claim about what it sent, and from M7 `curl` is a first-class
  // caller with no form in front of it at all.
  const parsed = createPasteSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "That paste is not valid.",
        // Flattened to field -> messages, which is the shape the form reads back.
        fields: flattenError(parsed.error).fieldErrors,
      },
      { status: 422 },
    );
  }

  try {
    const paste = await createPaste(viewer, parsed.data);
    return NextResponse.json({ id: paste.id }, { status: 201 });
  } catch (error) {
    if (error instanceof NotImplementedInStaticPhase) {
      // 501 is the honest code: the request was understood and well-formed, and the
      // server has not implemented the thing it asks for. The body carries the message
      // so the receipt can say which milestone implements it.
      return NextResponse.json(
        { error: error.message, notSent: true, landsIn: error.landsIn },
        { status: 501 },
      );
    }
    throw error;
  }
}
