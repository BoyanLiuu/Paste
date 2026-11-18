"use client";

import { useEffect } from "react";

import { mountRangeSelect } from "@/components/range-select";

// The one client component the view page renders. It owns no markup — the body is
// server-rendered HTML — and exists only to attach the listener and tear it down.
//
// Deliberately not inlined into the page as a <script>: that would need
// `script-src 'unsafe-inline'` or a nonce, and §6.5 keeps this page's policy at
// `script-src 'self'` because it is the page that renders hostile content.

export function RangeSelectMount({ targetId }: { targetId: string }) {
  useEffect(() => {
    const container = document.getElementById(targetId);
    if (container === null) return;
    // mountRangeSelect returns its own teardown, so it is the effect's cleanup
    // directly — holding it in a ref first added a hop and nothing else.
    return mountRangeSelect(container);
  }, [targetId]);

  return null;
}
