"use client";

import { useEffect, useRef, useState } from "react";

import type { Finding } from "@/lib/types";

// The hook behind the live scan badge.
//
// Deliberately not TanStack Query (§5). There is no cached remote state here: the
// answer belongs to one exact body and must never be served stale, which is the
// opposite of what a query cache is for. A debounce, an AbortController and a
// generation counter cover it.

const DEBOUNCE_MS = 400;

export type ScanStatus = "idle" | "scanning" | "clean" | "findings" | "failed";

export interface LiveScan {
  status: ScanStatus;
  findings: Finding[];
  language: string | null;
  /** True when only the first slice of the body was examined. */
  partial: boolean;
}

const IDLE: LiveScan = {
  status: "idle",
  findings: [],
  language: null,
  partial: false,
};

export function useDebouncedScan(body: string): LiveScan {
  const [state, setState] = useState<LiveScan>(IDLE);

  // Which request is current. An out-of-order response from an older body would
  // otherwise paint findings that do not belong to the text on screen — the one bug
  // that matters here, because it would mark clean text as holding a secret.
  const generation = useRef(0);

  const empty = body.trim() === "";

  useEffect(() => {
    // No setState in the effect body. An empty textarea resolves to idle during
    // render instead (see the return), and "scanning" is set when the request
    // actually starts rather than when the debounce does — which is both the honest
    // moment and the one that does not cascade a render.
    if (empty) return;

    const mine = ++generation.current;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      if (mine !== generation.current) return;
      setState((previous) => ({ ...previous, status: "scanning" }));
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as {
          findings: Finding[];
          state: "complete" | "partial";
          language: string;
        };
        if (mine !== generation.current) return;
        setState({
          status: payload.findings.length === 0 ? "clean" : "findings",
          findings: payload.findings,
          language: payload.language,
          partial: payload.state === "partial",
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (mine !== generation.current) return;
        // A failed live scan is not a blocked save: the create path scans again
        // server-side before inserting, and that is the one that decides.
        setState({
          status: "failed",
          findings: [],
          language: null,
          partial: false,
        });
        if (process.env.NODE_ENV !== "production") console.debug(error);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, empty]);

  // Derived, not stored: an empty body is idle by definition, and writing that into
  // state from an effect is a second source of truth plus a cascading render.
  return empty ? IDLE : state;
}
