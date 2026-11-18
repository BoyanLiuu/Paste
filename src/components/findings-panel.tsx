"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Finding } from "@/lib/types";

// What a refused create looks like (ux-06, 07, 08).
//
// Rendered against the user's own text, located to a line and column — not a modal
// saying "secret detected". A hard block is the harshest moment in the product, so the
// panel's job is to show the line and offer the way out, in that order.

const TIER_COPY: Record<1 | 2 | 3, { title: string; detail: string }> = {
  1: {
    title: "This cannot be saved",
    detail:
      "A provider-issued credential is a hard block, with no override for anyone. Redact it or edit it out, and nothing is written in the meantime — this paste has no URL and never had one.",
  },
  2: {
    title: "This looks like a secret",
    detail:
      "Redact it, edit it, or save anyway with a reason. Saving anyway is recorded against the paste.",
  },
  3: {
    title: "Something here looks random",
    detail:
      "A long high-entropy string next to a word like “token”. Often a checksum or an id, so this is a warning rather than a refusal.",
  },
};

export function FindingsPanel({
  findings,
  worstTier,
  onRedact,
  onDismiss,
  redacting,
}: {
  findings: Finding[];
  worstTier: 1 | 2 | 3;
  onRedact: () => void;
  onDismiss: () => void;
  redacting: boolean;
}) {
  const reduced = useReducedMotion();
  const copy = TIER_COPY[worstTier];

  return (
    <motion.section
      // Expands from zero height rather than appearing. An instant jump from a textarea
      // to a wall of red reads as a crash; 180 ms reads as an answer (Appendix E).
      initial={reduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="border-bad/50 bg-bad-soft/30 overflow-hidden rounded-lg border"
      aria-live="assertive"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-md">{copy.title}</h2>
          <Badge variant={worstTier === 1 ? "destructive" : "secondary"}>
            tier {worstTier}
          </Badge>
          <span className="text-muted-foreground text-sm">
            {findings.length} {findings.length === 1 ? "finding" : "findings"}
          </span>
        </div>

        <p className="text-ink-2 max-w-prose text-sm">{copy.detail}</p>

        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {findings.map((finding, index) => (
              <motion.li
                key={`${finding.rule}-${finding.line}-${finding.colStart}`}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduced ? undefined : { opacity: 0 }}
                // Staggered 40 ms apart so the replacements are countable: this is how
                // someone notices one that was not what they expected.
                transition={{
                  duration: 0.12,
                  delay: reduced ? 0 : index * 0.04,
                }}
                className="border-rule bg-card flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
              >
                <span className="num text-cool font-mono text-xs">
                  line {finding.line}, col {finding.colStart}
                </span>
                <span>{finding.label}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {/* First four and last four characters only. The panel never shows
                      the secret, for the same reason the database never stores it. */}
                  {finding.preview}
                </span>
                <Badge variant="outline" className="ml-auto">
                  tier {finding.tier}
                </Badge>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <div className="flex flex-wrap gap-3">
          <Button onClick={onRedact} disabled={redacting}>
            {redacting ? "Redacting…" : "Redact matched spans"}
          </Button>
          <Button variant="outline" onClick={onDismiss}>
            Edit it myself
          </Button>
        </div>
      </div>
    </motion.section>
  );
}
