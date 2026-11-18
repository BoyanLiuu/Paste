// The one schema that validates the create form and, from M7, the POST /api/pastes
// request body. Two callers, one definition: a browser path with its own validation
// drifts from the server's, and the server's is the one that matters.

import { z } from "zod";

import { RETENTION, RETENTION_CODES } from "@/lib/expiry/retention";
import { formatBytes } from "@/lib/format";
import { MAX_BYTES_WEB } from "@/lib/render/thresholds";

/** "auto" means run the detection ladder; anything else is an explicit choice that
 *  always wins and is never second-guessed (§5 rung 1). */
export const AUTO_LANGUAGE = "auto";

export const TITLE_MAX = 120;

/** Bodies are capped in **bytes**, not characters. A character count would let ~3 MB
 *  of CJK or emoji through a 10 MB gate, because UTF-8 spends up to four bytes on a
 *  code point. M7 re-checks this server-side against Content-Length and the streamed
 *  count, since a client is only ever making a claim. */
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;

export const createPasteSchema = z
  .object({
    body: z.string().min(1, "Nothing to save yet."),
    title: z
      .string()
      .max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`)
      .optional(),
    language: z.string().default(AUTO_LANGUAGE),
    lineNumbers: z.boolean().default(false),
    retention: z.enum(RETENTION_CODES),
    neverReason: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const bytes = byteLength(value.body);
    if (bytes > MAX_BYTES_WEB) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        // Name the real size: "too large" leaves the user guessing how much to cut.
        message: `That is ${formatBytes(bytes)}. The limit is ${formatBytes(
          MAX_BYTES_WEB,
        )} — this is a file, not a snippet.`,
      });
    }

    // "never" is the only retention with unbounded cost, and the reason is what keeps
    // it rare without making it hard. Enforced here rather than in the component so
    // the API path cannot be talked out of it.
    if (
      RETENTION[value.retention].needsReason &&
      (value.neverReason ?? "").trim() === ""
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["neverReason"],
        message: "Say why this one never expires.",
      });
    }
  });

export type CreatePasteValues = z.input<typeof createPasteSchema>;
export type CreatePaste = z.output<typeof createPasteSchema>;
