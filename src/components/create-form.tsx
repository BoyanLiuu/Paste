"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ExpiryReadout } from "@/components/expiry-readout";
import { CreateReceipt, type Receipt } from "@/components/create-receipt";
import { FindingsPanel } from "@/components/findings-panel";
import { useDebouncedScan } from "@/components/use-debounced-scan";
import { redact } from "@/lib/secrets/redact";
import { scan as scanNow, worstTier } from "@/lib/secrets/scan";
import {
  DEFAULT_RETENTION,
  RETENTION,
  RETENTION_CODES,
} from "@/lib/expiry/retention";
import { formatBytes } from "@/lib/format";
import { MAX_BYTES } from "@/lib/render/thresholds";
import { buildOversizedBody, SAMPLE_BODIES } from "@/lib/samples";
import {
  AUTO_LANGUAGE,
  byteLength,
  createPasteSchema,
  type CreatePasteValues,
} from "@/lib/schema/create-paste";
import type { Finding, RetentionCode } from "@/lib/types";

// Languages offered explicitly. Short on purpose: the ladder handles the rest, and a
// 190-entry list invites picking wrong more than it invites picking right.
const LANGUAGES = [
  { id: AUTO_LANGUAGE, label: "Detect it" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Shell" },
  { id: "dockerfile", label: "Dockerfile" },
  { id: "log", label: "A log" },
  { id: "plaintext", label: "Plain text" },
] as const;

interface Props {
  /** Fixed by the server at render so the expiry date cannot drift between the panel
   *  and the eventual save. */
  now: number;
  /** Prefilled from ?sample=, so the designed states are reachable by URL. */
  initialBody?: string;
  initialTitle?: string;
  /** Build an over-the-cap body locally rather than receiving one. Sending 10 MB to
   *  demonstrate a 10 MB limit cost 20.8 MB of transfer, since the body lands in both
   *  the rendered textarea and the RSC payload. */
  oversized?: boolean;
}

/** One line repeated past the web cap. Cheap to build and never leaves the browser.
 *
 *  Deliberately ~11 MB rather than a hair over 10: at cap+1KB both sizes round to
 *  "10.0 MB" and the refusal reads "That is 10.0 MB. The limit is 10.0 MB", which
 *  looks like a bug rather than a limit. The prototype labels this sample "11 MB of
 *  log" for the same reason. */
function measure(text: string): { bytes: number; lines: number } {
  return {
    bytes: byteLength(text),
    lines: text === "" ? 0 : text.replace(/\n$/, "").split("\n").length,
  };
}

export function CreateForm({
  now,
  initialBody = "",
  initialTitle = "",
  oversized = false,
}: Props) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** Findings from the last submit attempt, which is what the panel shows. The live
   *  badge uses the debounced scan separately — the panel only ever reflects a scan of
   *  the exact bytes the user tried to save. */
  const [blocked, setBlocked] = useState<Finding[] | null>(null);
  const [redacting, setRedacting] = useState(false);

  // Built once, not per render. The `defaultValues` object literal below is rebuilt on
  // every render even though react-hook-form only reads it on the first, so calling
  // buildOversizedBody() inline would allocate 10 MB each time.
  const startingBody = useMemo(
    () => (oversized ? buildOversizedBody() : initialBody),
    [oversized, initialBody],
  );

  const form = useForm<CreatePasteValues>({
    resolver: standardSchemaResolver(createPasteSchema),
    mode: "onSubmit",
    defaultValues: {
      body: startingBody,
      title: initialTitle,
      language: AUTO_LANGUAGE,
      lineNumbers: false,
      retention: DEFAULT_RETENTION,
      neverReason: "",
    },
  });

  // useWatch subscribes this component rather than the whole form, and each field is
  // its own subscription so a keystroke does not invalidate the selects.
  const control = form.control;
  const body = useWatch({ control, name: "body" }) ?? "";
  const retention = (useWatch({ control, name: "retention" }) ??
    DEFAULT_RETENTION) as RetentionCode;
  const language = useWatch({ control, name: "language" });
  const lineNumbers = useWatch({ control, name: "lineNumbers" }) ?? false;

  // Measuring the body is O(n) and the panel showing the result is not urgent. Done
  // on every keystroke at 10 MB it costs ~8.8ms — over half a frame — because
  // TextEncoder allocates the whole buffer and split() allocates a 214k-element
  // array. Deferring keeps typing on the fast path and lets the counts land a frame
  // late, which nobody can see. Large logs are this product's main case, not an edge.
  const deferredBody = useDeferredValue(body);
  const { bytes, lines } = useMemo(() => measure(deferredBody), [deferredBody]);
  const live = useDebouncedScan(deferredBody);

  function onRedact() {
    setRedacting(true);
    try {
      const current = form.getValues("body") ?? "";
      // Re-scanned against the exact current text, not the stored findings: offsets
      // are only valid for the bytes they were computed from, and the textarea may
      // have moved on. This is also why the button lives on the refusal rather than
      // next to the live badge (Appendix B).
      const fresh = scanNow(current);
      const result = redact(current, fresh.findings);
      form.setValue("body", result.body, { shouldDirty: true });
      setBlocked(
        result.rescan.findings.length === 0 ? null : result.rescan.findings,
      );
    } finally {
      setRedacting(false);
    }
  }

  async function onSubmit(values: CreatePasteValues) {
    // The client scan is a courtesy; the server scans again before the insert and that
    // is the one that decides (§6.1). Checking here means the user sees the finding
    // against their own text without a round trip.
    const result = scanNow(values.body);
    if (result.findings.length > 0) {
      setBlocked(result.findings);
      return;
    }
    setBlocked(null);
    // Posts to the real endpoint. In the static phase it validates and refuses, and
    // that refusal is what the receipt reports — so only the route's body changes at
    // M7, not this caller (Appendix C, rule 4).
    //
    // A client component cannot import the mutation directly: that module is
    // `server-only`, and the guard is the point.
    let response: Response;
    try {
      response = await fetch("/api/pastes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
    } catch {
      // A fetch that never reached the server. The text stays in the form.
      setReceipt({ kind: "offline" });
      return;
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "60");
      setReceipt({ kind: "rate-limited", retryAfterSeconds: retryAfter });
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      id?: string;
      notSent?: boolean;
      landsIn?: string;
      fields?: Record<string, string[]>;
    } | null;

    if (response.status === 422 && payload?.fields !== undefined) {
      // The server found something the client's copy of the schema did not. Put it back
      // on the field rather than in a banner, so it is answerable where it happened.
      for (const [field, messages] of Object.entries(payload.fields)) {
        if (messages[0] === undefined) continue;
        form.setError(field as keyof CreatePasteValues, {
          message: messages[0],
        });
      }
      return;
    }

    if (response.status === 201 && payload?.id !== undefined) {
      // THE SAVED STATE GOES IN THE URL, unlike every refusal below, which stays local.
      //
      // Two bugs came from holding it here. The page's "New paste / Pick how long it lives
      // now" heading is rendered by the server component above this one, which cannot see
      // this state — so it sat above the receipt telling someone to choose a retention for
      // a paste they had already saved. And the "New paste" controls in the hero and the
      // nav are links to `/` and `/#new`: from `/` those are not navigations at all, so
      // they changed the address bar and left the receipt on screen.
      //
      // With `?saved=<id>` the page owns the decision, the heading disappears with the
      // form, and every "New paste" link becomes a real navigation away from a different
      // URL. Refreshing also keeps the link rather than losing it, which matters on the one
      // screen whose output is a thing you are about to paste somewhere else.
      //
      // The refusals stay local deliberately: each one carries text that was never sent,
      // and a navigation would discard it.
      // `scroll: false` because the receipt replaces the form IN PLACE. Next scrolls to
      // the top of the document on a navigation by default, which put the hero back on
      // screen and the confirmation below the fold — so the reward for saving was a page
      // that appeared to have forgotten.
      router.replace(`/?saved=${payload.id}`, { scroll: false });
      return;
    }

    if (payload?.notSent === true) {
      // Measured from the validated body rather than the deferred render value, which
      // can be a frame behind, and reported for the retention the schema accepted.
      const exact = measure(values.body);
      setReceipt({
        kind: "not-sent",
        message: payload.error ?? "Saving is not built yet.",
        landsIn: payload.landsIn,
        bytes: exact.bytes,
        lines: exact.lines,
        retention: values.retention as RetentionCode,
      });
      return;
    }

    setReceipt({
      kind: "failed",
      message: payload?.error ?? `The server answered ${response.status}.`,
    });
  }

  if (receipt !== null) {
    return (
      <CreateReceipt receipt={receipt} onDismiss={() => setReceipt(null)} />
    );
  }

  const errors = form.formState.errors;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">
            Title <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input id="title" {...form.register("title")} />
          <p className="text-muted-foreground text-xs">
            Never filled in from the text, so it can say nothing at all. Lists
            show it.
          </p>
          <FieldError message={errors.title?.message} />
        </div>

        {blocked !== null ? (
          <FindingsPanel
            findings={blocked}
            worstTier={worstTier(blocked) ?? 2}
            onRedact={onRedact}
            onDismiss={() => setBlocked(null)}
            redacting={redacting}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="body">Text</Label>
            <ScanBadge live={live} />
          </div>
          {/* `field-sizing-fixed` IS THE POINT OF THIS className. The shadcn base carries
              `field-sizing-content`, which grows the control with its content — so
              `rows={16}` was being ignored and a 40-line sample pushed the whole page
              down, taking the expiry panel with it. The panel is the thing §6.3 wants read
              before saving, so a box that scrolls the page instead of itself buries the
              one piece of information the screen exists to surface.

              With content sizing off, `rows` governs the height natively and the textarea
              scrolls internally — no hardcoded pixel height to go stale against the font.
              `resize-y` keeps the control growable on purpose, which is different from
              growing on its own. */}
          <Textarea
            id="body"
            rows={16}
            spellCheck={false}
            className="field-sizing-fixed resize-y font-mono text-sm"
            {...form.register("body")}
          />
          <p className="text-muted-foreground text-xs">
            Up to {formatBytes(MAX_BYTES)}. Logs, configs and stack traces are
            what most people paste.
          </p>
          <FieldError message={errors.body?.message} />
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <div className="flex min-w-44 flex-col gap-2">
            <Label htmlFor="language">Language</Label>
            <Select
              value={language}
              onValueChange={(value) => form.setValue("language", value)}
            >
              <SelectTrigger id="language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-44 flex-col gap-2">
            <Label htmlFor="retention">Keep it for</Label>
            <Select
              value={retention}
              onValueChange={(value) =>
                form.setValue("retention", value as RetentionCode)
              }
            >
              <SelectTrigger id="retention" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {RETENTION[code].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 pb-2">
            <Switch
              id="lineNumbers"
              checked={lineNumbers}
              onCheckedChange={(checked) =>
                form.setValue("lineNumbers", checked)
              }
            />
            <Label htmlFor="lineNumbers" className="font-normal">
              Line numbers
            </Label>
          </div>
        </div>

        {/* Revealed only when it is required, rather than sitting there asking a
            question most pastes never face. */}
        {RETENTION[retention].needsReason ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="neverReason">Why does this one never expire?</Label>
            <Input
              id="neverReason"
              placeholder="Linked from the Q3 retention design doc."
              {...form.register("neverReason")}
            />
            <p className="text-muted-foreground text-xs">
              Shown on the page. It is what keeps “never” rare rather than
              forbidden.
            </p>
            <FieldError message={errors.neverReason?.message} />
          </div>
        ) : null}

        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>

        <Separator />

        <p className="text-muted-foreground text-xs">
          Sample text:{" "}
          {SAMPLES.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? ", " : ""}
              <Link className="underline" href={`/?sample=${s.id}`}>
                {s.label}
              </Link>
            </span>
          ))}
        </p>
      </form>

      <ExpiryReadout
        retention={retention}
        now={now}
        byteSize={bytes}
        lineCount={lines}
        language={
          body === "" || language === AUTO_LANGUAGE
            ? null
            : (LANGUAGES.find((l) => l.id === language)?.label ??
              language ??
              null)
        }
      />
    </div>
  );
}

// Derived from SAMPLE_BODIES rather than listed again.
//
// This was a second hardcoded list of the same five labels, and the duplication did what
// duplication does: it still said "11 MB of log" after the size ceiling moved to 25 MB and
// `samples.ts` had been corrected. One source, and the oversize label now comes from the
// ceiling itself so neither copy can go stale.
const SAMPLES = (["python", "log", "aws", "password", "huge"] as const).map(
  (id) => ({ id, label: SAMPLE_BODIES[id].label }),
);

const BADGE_COPY: Record<string, string> = {
  idle: "",
  scanning: "Checking…",
  clean: "No secrets found",
  findings: "Possible secret",
  failed: "Check unavailable",
};

/** Crossfades between states and never reflows: it sits beside a textarea someone is
 *  typing into, and layout movement under a caret is worse than no feedback. */
function ScanBadge({ live }: { live: ReturnType<typeof useDebouncedScan> }) {
  if (live.status === "idle") return null;
  const tone =
    live.status === "findings"
      ? "text-bad"
      : live.status === "clean"
        ? "text-ok"
        : "text-muted-foreground";
  return (
    <span
      className={`font-mono text-xs transition-opacity ${tone}`}
      aria-live="polite"
    >
      {BADGE_COPY[live.status]}
      {live.status === "findings" ? ` (${live.findings.length})` : ""}
      {live.partial ? " · first 1 MB" : ""}
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="text-bad text-sm">
      {message}
    </p>
  );
}
