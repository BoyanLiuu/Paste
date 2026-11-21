"use client";

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
import { buildOversizedBody } from "@/lib/samples";
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
      // A FULL NAVIGATION, NOT `router.replace`. Measured on the production build:
      // `router.replace("/new?saved=<id>", { scroll: false })` navigated to `/new` with the
      // QUERY STRIPPED, twice, so the form reappeared empty and the link the person had
      // just created was gone. A `page.goto` to the same URL renders the receipt correctly,
      // so the destination was never the problem — only the client-side navigation to it.
      //
      // It worked while the form lived at `/`, which is the clue: that route read the
      // request and was dynamic, and `/new` prerenders its shell because every request read
      // sits inside a Suspense boundary. Under `cacheComponents` a soft navigation to a
      // prerendered route appears to resolve against the shell's own URL.
      //
      // `location.assign` costs one full load at the end of an interaction, which is the
      // cheapest moment to pay for it — and it buys a URL that is real: refreshable,
      // shareable, and the thing the receipt is for. `scroll: false` is no longer needed
      // because the heading above the form disappears with it, so the receipt lands at the
      // top of the page rather than below a stale instruction.
      // A FULL NAVIGATION, AND THREE THINGS WERE TRIED FIRST. Measured on the production
      // build, `?saved=` is unreachable by soft navigation from this route:
      //
      //   1. `router.replace("/new?saved=<id>", { scroll: false })` — landed on `/new` with
      //      the QUERY STRIPPED, so a successful save returned an empty form and discarded
      //      the link the person had just created.
      //   2. `router.push(...)` — identical.
      //   3. `export const dynamic = "force-dynamic"` on the route, to restore the
      //      behaviour this had while the form lived at `/` — refused outright:
      //      "Route segment config "dynamic" is not compatible with
      //      nextConfig.cacheComponents".
      //
      // A full `page.goto` to the same URL renders the receipt correctly, so the
      // destination was never wrong. `/new` prerenders its shell because every request read
      // sits inside a Suspense boundary, and a soft navigation appears to resolve against
      // that shell's own URL.
      //
      // The lint rule below recommends `useRouter().push()`, which is option 2 and does not
      // work here. Disabled with the measurement rather than silenced, because the rule is
      // right in general and the next person should see why this is the exception.
      //
      // The cost is one full load at the end of an interaction — the cheapest moment to pay
      // it — and it buys a URL that is real: refreshable, shareable, and the thing the
      // receipt exists to hand over.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/new?saved=${payload.id}`);
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

  // Tier 1 is the only tier that cannot be saved at all, so it is the only one that
  // changes what the controls offer. `live` is the debounced in-page scan, which is
  // advisory — `create-paste.ts` scans again inside the transaction, and that is the
  // enforcement.
  const tier1 =
    live.status === "findings" ? live.findings.filter((f) => f.tier === 1) : [];
  const blockedByScan = tier1.length > 0;

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
            // An empty 330px box is the visual centre of this page, and a void there
            // reads as a broken editor rather than an invitation.
            placeholder={"Paste a log, a config, a stack trace…"}
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

        {/* SAVE REFUSES WHILE A TIER-1 FINDING IS LIVE, and the reason sits beside it.
            It was enabled in the one state the page labels "Cannot be saved": a full brand
            primary inviting the click that the product's central claim says is impossible.
            The server refuses it either way — `assertCan` and the scan run again before the
            insert — so this is not the enforcement, it is the affordance telling the truth
            about what the enforcement will do. Tier 2 and 3 stay clickable, because those
            are the ones a written justification gets past. */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || blockedByScan}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
          {blockedByScan ? (
            <p className="text-bad text-sm">
              A tier-1 secret cannot be saved. Redact it, or remove the line.
            </p>
          ) : null}
        </div>

        {/* The sample links used to live here, as 11px text nobody found. They are a row
            under this page's heading now — the same `?sample=` links, owned by
            `/new/page.tsx` because they are navigation rather than form state. */}
      </form>

      <div className="flex flex-col gap-4 self-start">
        {/* THE REFUSAL, WHILE IT IS HAPPENING. `FindingsPanel` renders only after a submit
            attempt, so the demonstration the samples exist for — load the AWS sample and
            watch the scanner refuse it — showed a 13px badge and nothing else: the finding
            was neither named nor located.
            `preview` is the first four and last four characters only, never the secret
            (§6.1), which is what makes it safe to print beside the text it came from. */}
        {blockedByScan ? (
          <section
            aria-live="polite"
            className="border-bad/40 bg-card flex flex-col gap-3 rounded-lg border p-5"
          >
            <h2 className="text-bad text-sm font-medium">
              {tier1.length === 1
                ? "This cannot be saved"
                : `${tier1.length} findings cannot be saved`}
            </h2>
            {tier1.slice(0, 3).map((finding) => (
              <div
                key={`${finding.rule}-${finding.line}-${finding.colStart}`}
                className="flex flex-col gap-1"
              >
                <p className="text-sm">{finding.label}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  line {finding.line}, column {finding.colStart} ·{" "}
                  <span className="bg-brand-soft text-ink rounded px-1">
                    {finding.preview}
                  </span>
                </p>
              </div>
            ))}
            <p className="text-ink-2 text-xs leading-relaxed">
              No paste is written and no id is issued, so there is nothing to
              retract.
            </p>
          </section>
        ) : null}

        {/* `self-start` on the wrapper so the panel sizes to its content. Stretched to the
            grid row it grew a tall empty bottom, which a bordered card makes
            conspicuous. */}
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
    </div>
  );
}

const BADGE_COPY: Record<string, string> = {
  idle: "",
  scanning: "Checking…",
  clean: "No secrets found",
  findings: "Possible secret",
  failed: "Check unavailable",
};

// TIER 1 IS NOT ANNOUNCED HERE AT ALL, and that is the second answer to the same problem.
//
// "Possible secret" was wrong for a tier-1 finding — it reads as a warning about something
// overridable, when the paste is refused outright. The first fix gave this badge its own
// sentence, "Cannot be saved", which put that sentence in the viewport three times: here,
// in the refusal panel's header, and beside the disabled Save button.
//
// The panel wins, because it is the only one of the three that names the rule and locates
// the match, and the Save-side line keeps the recovery. So on tier 1 the badge says
// nothing and the panel beside it speaks. Tier 2 and 3 keep the badge: there is no panel
// for them until a submit attempt, and a written reason gets them past.

/** Crossfades between states and never reflows: it sits beside a textarea someone is
 *  typing into, and layout movement under a caret is worse than no feedback. */
function ScanBadge({ live }: { live: ReturnType<typeof useDebouncedScan> }) {
  if (live.status === "idle") return null;
  const blocked =
    live.status === "findings" && live.findings.some((f) => f.tier === 1);
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
      {blocked ? "" : BADGE_COPY[live.status]}
      {live.status === "findings" && !blocked
        ? ` (${live.findings.length})`
        : ""}
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
