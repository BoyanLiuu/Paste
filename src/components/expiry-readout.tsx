"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { formatBytes, formatCount, formatDate, formatTime } from "@/lib/format";
import { PURGE_GAP_MS, RETENTION } from "@/lib/expiry/retention";
import { HIGHLIGHT_LINES } from "@/lib/render/thresholds";
import type { RetentionCode } from "@/lib/types";

// The "Before it gets a link" panel. Retention is the most consequential control in
// the product and the one users ignore, so the animation is on the *consequence* — the
// date this link stops answering — and never on the select itself (Appendix E).

interface Props {
  retention: RetentionCode;
  /** Fixed at render so the date cannot drift mid-interaction. */
  now: number;
  byteSize: number;
  lineCount: number;
  language: string | null;
}

export function ExpiryReadout({
  retention,
  now,
  byteSize,
  lineCount,
  language,
}: Props) {
  const reduced = useReducedMotion();
  const option = RETENTION[retention];
  const expiresAt = option.ms === null ? null : now + option.ms;
  const purgeAt = expiresAt === null ? null : expiresAt + PURGE_GAP_MS;

  return (
    <aside className="bg-card border-rule flex flex-col gap-4 rounded-lg border p-6">
      <h2 className="text-md">Before it gets a link</h2>

      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground font-mono text-xs">Expires</p>
        {/* The key makes each value its own element, so AnimatePresence crossfades the
            date rather than mutating text in place. 120ms, opacity only: a date that
            slides or scales draws the eye to the motion instead of the number.
            popLayout, not "wait": wait runs exit before enter, so two quick retention
            changes queue to 240ms and briefly show nothing where the date was — the
            opposite of what this animation is for. popLayout takes the outgoing
            element out of flow so the two cross-dissolve without a layout jump. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={expiresAt ?? "never"}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="num font-mono text-2xl"
          >
            {expiresAt === null ? "Never" : formatDate(expiresAt)}
          </motion.p>
        </AnimatePresence>
        <p className="text-muted-foreground text-sm">
          {expiresAt === null ? (
            <>Nothing removes this one. Say why below.</>
          ) : (
            <>
              <span className="text-cool font-mono">
                {formatTime(expiresAt)}
              </span>
              {", "}
              {option.label.toLowerCase()} after saving. The bytes are purged on{" "}
              {formatDate(purgeAt!)}.
            </>
          )}
        </p>
      </div>

      <dl className="border-rule flex flex-col gap-0 border-t pt-2 text-sm">
        <Row label="Secrets" value="Checked as you type" />
        <Row
          label="Language"
          value={language ?? "Detected when there's text"}
        />
        <Row
          label="Size"
          value={
            byteSize === 0
              ? "Nothing yet"
              : `${formatBytes(byteSize)} · ${formatCount(lineCount)} lines`
          }
        />
        <Row
          label="Highlighting"
          value={
            lineCount > HIGHLIGHT_LINES
              ? `Off above ${formatCount(HIGHLIGHT_LINES)} lines`
              : `On up to ${formatCount(HIGHLIGHT_LINES)} lines`
          }
        />
      </dl>

      <p className="text-muted-foreground text-xs">
        Checked in this page with sample rules. Not connected to{" "}
        <span className="font-mono">POST /api/scan</span> yet.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-rule flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
