"use client";

// The removal request form (ux-34 – 36).
//
// A client component for one reason: the refusal is a designed state on the form, with the
// claim they made still in front of them (ux-35, "refused before it's sent"). `useActionState`
// keeps the typed justification and shows why — a thrown error would replace the page and
// lose it, which for a four-field form about a security problem is the difference between
// "fix the one field" and "start again".
//
// Everything else is a plain form: native inputs, no controlled state, no validation
// library. The server action validates again regardless, because this file is the one place
// in the flow an attacker can skip.

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestRemovalAction,
  type RemovalFormState,
} from "@/actions/request-removal";

const RELATIONSHIPS = [
  { value: "owner", label: "Its owner" },
  { value: "manager_of_owner", label: "The owner’s manager" },
  { value: "security", label: "On the security team" },
  { value: "other", label: "None of these" },
] as const;

const REASONS = [
  { value: "secret", label: "It contains a secret" },
  { value: "pii", label: "It contains personal data" },
  { value: "former_employee", label: "It belongs to a former employee" },
  { value: "mistake", label: "It was a mistake" },
  { value: "other", label: "Something else" },
] as const;

export function RemovalForm({ pasteId }: { pasteId: string }) {
  const [state, action, pending] = useActionState<RemovalFormState, FormData>(
    requestRemovalAction,
    { kind: "idle" },
  );

  if (state.kind === "sent") {
    return <Sent pasteId={pasteId} requestId={state.requestId} />;
  }

  return (
    <form action={action} className="flex max-w-xl flex-col gap-6">
      <input type="hidden" name="id" value={pasteId} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">You are</legend>
        {RELATIONSHIPS.map((option) => (
          <label
            key={option.value}
            className="border-rule flex items-center gap-3 rounded-md border p-3 text-sm"
          >
            <input
              type="radio"
              name="relationship"
              value={option.value}
              aria-describedby="relationship-help"
            />
            <span>{option.label}</span>
          </label>
        ))}
        <p className="text-muted-foreground text-sm" id="relationship-help">
          Only the first three can ask. Anyone else is refused — and the choice
          is recorded for the moderator rather than used to grant anything.
        </p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">Reason</Label>
        <select
          id="reason"
          name="reason"
          defaultValue=""
          aria-describedby="reason-help"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">Pick one</option>
          {REASONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-sm" id="reason-help">
          A secret is usually redacted rather than deleted.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="justification">What’s wrong, and where</Label>
        <Textarea
          id="justification"
          name="justification"
          rows={4}
          aria-describedby="justification-help"
        />
        <p className="text-muted-foreground text-sm" id="justification-help">
          Name the lines if you can. The moderator and the audit record keep
          this.
        </p>
      </div>

      {state.kind === "refused" ? (
        <p
          role="status"
          className="border-rule bg-card text-ink-2 rounded-md border p-3 text-sm"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
        <Link
          href={`/p/${pasteId}`}
          className="text-muted-foreground text-sm underline"
        >
          Back to the paste
        </Link>
      </div>
    </form>
  );
}

/**
 * The receipt (ux-36's successful sibling).
 *
 * It names the request number, because that number is what the moderator's decision and
 * the audit trail both cite — and it is the only thing the requester can refer to later.
 */
function Sent({
  pasteId,
  requestId,
}: {
  pasteId: string;
  requestId: number;
}) {
  return (
    <div className="border-rule bg-card flex max-w-xl flex-col gap-3 rounded-lg border p-5">
      <h2 className="text-lg">Request #{requestId} is open</h2>
      <p className="text-ink-2 text-sm">
        A moderator reads every request. Most end with the paste kept or a
        secret redacted — the link keeps working either way, and the decision is
        on the record with its reason.
      </p>
      <p className="text-ink-2 text-sm">
        Nothing about the paste has changed yet.
      </p>
      <Link href={`/p/${pasteId}`} className="text-sm underline">
        Back to the paste
      </Link>
    </div>
  );
}
