"use client";

import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { RETENTION } from "@/lib/expiry/retention";
import { formatBytes, formatCount } from "@/lib/format";
import type { RetentionCode } from "@/lib/types";

// What the form shows after a submit. In the static phase every path lands on
// "nothing was sent", which the prototype designs rather than treats as an error
// (ux-05): the user did everything right and the product has not been built yet, so
// the screen says exactly that instead of apologising in red.

export type Receipt =
  | { kind: "saved"; id: string }
  | {
      kind: "not-sent";
      message: string;
      landsIn?: string;
      bytes: number;
      lines: number;
      retention: RetentionCode;
    }
  | { kind: "offline" }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "too-large"; bytes: number }
  | { kind: "failed"; message: string };

export function CreateReceipt({
  receipt,
  onDismiss,
}: {
  receipt: Receipt;
  onDismiss: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border-rule flex max-w-2xl flex-col gap-4 rounded-lg border p-6"
      aria-live="polite"
    >
      <Body receipt={receipt} />
      <div className="flex gap-3">
        <Button onClick={onDismiss}>Back to the form</Button>
      </div>
    </motion.section>
  );
}

function Body({ receipt }: { receipt: Receipt }) {
  switch (receipt.kind) {
    case "saved":
      return (
        <>
          <h2 className="text-lg">Saved</h2>
          <p className="font-mono text-sm">/p/{receipt.id}</p>
        </>
      );

    case "not-sent":
      return (
        <>
          <h2 className="text-lg">Nothing was sent</h2>
          <p className="text-ink-2">
            The form validated and the request reached the server, which refused
            it: saving is not built yet.
          </p>
          <dl className="border-rule flex flex-col border-t pt-3 text-sm">
            <Row
              label="Would have kept it"
              value={RETENTION[receipt.retention].label}
            />
            <Row
              label="Size"
              value={`${formatBytes(receipt.bytes)} · ${formatCount(receipt.lines)} lines`}
            />
            {receipt.landsIn === undefined ? null : (
              <Row label="Lands in" value={receipt.landsIn} />
            )}
          </dl>
          <p className="text-muted-foreground font-mono text-xs">
            {receipt.message}
          </p>
        </>
      );

    case "offline":
      return (
        <>
          <h2 className="text-lg">You are offline</h2>
          <p className="text-ink-2">
            The text is still in the form. Nothing was sent, and nothing was
            lost — reconnect and save again.
          </p>
        </>
      );

    case "rate-limited":
      return (
        <>
          <h2 className="text-lg">Too many pastes just now</h2>
          <p className="text-ink-2">
            The limit counts attempts, not saves, so a refused paste still costs
            one. Try again in {receipt.retryAfterSeconds} seconds.
          </p>
        </>
      );

    case "too-large":
      return (
        <>
          <h2 className="text-lg">That is a file, not a snippet</h2>
          <p className="text-ink-2">
            {formatBytes(receipt.bytes)} is over the limit. Nothing was sent.
          </p>
        </>
      );

    case "failed":
      return (
        <>
          <h2 className="text-lg">That did not save</h2>
          <p className="text-ink-2">
            The text is still in the form, so nothing was lost.
          </p>
          <p className="text-muted-foreground font-mono text-xs">
            {receipt.message}
          </p>
        </>
      );
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-rule flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
