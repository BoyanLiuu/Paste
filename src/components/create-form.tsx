"use client";

import Link from "next/link";
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
import {
  DEFAULT_RETENTION,
  RETENTION,
  RETENTION_CODES,
} from "@/lib/expiry/retention";
import { formatBytes } from "@/lib/format";
import { MAX_BYTES_WEB } from "@/lib/render/thresholds";
import {
  AUTO_LANGUAGE,
  byteLength,
  createPasteSchema,
  type CreatePasteValues,
} from "@/lib/schema/create-paste";
import type { RetentionCode } from "@/lib/types";

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
function buildOversizedBody(): string {
  const line =
    "2026-11-12T07:41:03.188Z INFO payments-api request status=200\n";
  return line.repeat(Math.ceil((MAX_BYTES_WEB * 1.1) / line.length));
}

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

  async function onSubmit(values: CreatePasteValues) {
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
      setReceipt({ kind: "saved", id: payload.id });
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="body">Text</Label>
          <Textarea
            id="body"
            rows={16}
            spellCheck={false}
            className="font-mono text-sm"
            {...form.register("body")}
          />
          <p className="text-muted-foreground text-xs">
            Up to {formatBytes(MAX_BYTES_WEB)}. Logs, configs and stack traces
            are what most people paste.
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

const SAMPLES = [
  { id: "python", label: "clean Python" },
  { id: "log", label: "a log" },
  { id: "aws", label: "an AWS key" },
  { id: "password", label: "a password" },
  { id: "huge", label: "11 MB of log" },
] as const;

function FieldError({ message }: { message?: string }) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="text-bad text-sm">
      {message}
    </p>
  );
}
