"use server";

// Opening a removal request, as a server action (ARCHITECTURE §3, §6.3, ux-34 – 36, 42).
//
// REMOVAL IS A REQUEST, NEVER A BUTTON. The screen says so and this is where it becomes
// true: there is no delete, an owner or a moderator asks, and a moderator decides on the
// record. The bias is toward keeping the paste, because its URL is in a ticket somewhere.
//
// The refusal is returned rather than thrown, because ux-35 is a designed state — "refused
// before it's sent", on the form, with the claim they made still in front of them. A
// thrown error would replace the form with an error page and lose what they typed.

import { PasteNotFound, RemovalNotAllowed } from "@/lib/server/removal";
import { requestRemoval } from "@/lib/server/mutations";
import { getViewer } from "@/lib/server/session";
import { NotPermittedError } from "@/lib/server/viewer";
import type { Relationship, RemovalReason } from "@/lib/types";

export type RemovalFormState =
  | { kind: "idle" }
  | { kind: "sent"; requestId: number }
  | { kind: "refused"; message: string };

const RELATIONSHIPS: Relationship[] = [
  "owner",
  "manager_of_owner",
  "security",
  "other",
];

const REASONS: RemovalReason[] = [
  "secret",
  "pii",
  "former_employee",
  "mistake",
  "other",
];

export async function requestRemovalAction(
  _previous: RemovalFormState,
  formData: FormData,
): Promise<RemovalFormState> {
  const pasteId = String(formData.get("id") ?? "");
  const relationship = String(formData.get("relationship") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const justification = String(formData.get("justification") ?? "");

  // Validated against the lists rather than cast. A `FormData` value is whatever was
  // posted, and casting it to `Relationship` would let an invented value reach the
  // database — where it would sit in the queue as a relationship no screen can render.
  if (!RELATIONSHIPS.includes(relationship as Relationship)) {
    return { kind: "refused", message: "Say which of these you are." };
  }
  if (!REASONS.includes(reason as RemovalReason)) {
    return { kind: "refused", message: "Pick a reason." };
  }
  if (justification.trim() === "") {
    return {
      kind: "refused",
      message:
        "Say what is wrong and where. The moderator cannot decide without it.",
    };
  }

  try {
    const viewer = await getViewer();
    const { requestId } = await requestRemoval(viewer, pasteId, {
      relationship: relationship as Relationship,
      reason: reason as RemovalReason,
      justification,
    });
    return { kind: "sent", requestId };
  } catch (error) {
    if (error instanceof RemovalNotAllowed) {
      // The honest refusal, in the requester's words rather than the code's. `removal.ts`
      // explains why `manager_of_owner` and `security` are refused for a non-owner: the
      // claim is not the authority, and there is no org graph to check it against.
      return { kind: "refused", message: error.why };
    }
    if (error instanceof PasteNotFound) {
      return { kind: "refused", message: "That paste no longer exists." };
    }
    if (error instanceof NotPermittedError) {
      return { kind: "refused", message: "Sign in to ask for a removal." };
    }

    console.error("request-removal: unexpected failure", error);
    return { kind: "refused", message: "That did not send. Try again." };
  }
}
