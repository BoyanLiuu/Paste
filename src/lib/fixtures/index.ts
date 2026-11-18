// Phase 1 sample data, ported from the prototype's hallmark/data.js.
//
// A READ-ONLY TYPED MODULE. No store, no mutation helpers, no persistence — there is
// then no fake persistence to unpick when phase 2 arrives (Appendix C, rule 1). These
// become the Vitest corpus, so nothing here is thrown away.
//
// The spread is deliberate: every `state`, every `retention` code, and every rung of
// the §6.2 size ladder appears at least once. `fixtures.spec.ts` asserts that, because
// a fixture set that cannot exercise a screen hides the gap until phase 2.

import { createHash } from "node:crypto";

import { expiresAt, purgeAfter } from "@/lib/expiry/retention";
import { storageFor } from "@/lib/render/thresholds";
import type {
  Paste,
  RemovalRequest,
  Revision,
  User,
  AuditEntry,
} from "@/lib/types";

import {
  BASH,
  DOCKER,
  FLAKY_COPY,
  INGEST_LOG,
  KUBE_LOG,
  LAPTOP,
  NOTES,
  PAY_LOG,
  PY,
  SAMPLE_PASSWORD,
  SMOKE,
  SQL,
  YAML_REV1,
  YAML_REV2,
} from "./bodies";

/** The sample's "now" — the real clock, not a frozen date.
 *
 *  Fixture dates are offsets from this rather than absolute strings. They were
 *  originally absolute, authored around 12 Nov 2026, and that rotted: §6.3 requires
 *  expiry be recomputed against the real clock, so six days later every 1-hour and
 *  1-day paste had genuinely expired and the designed "live log" screen was
 *  unreachable. The relative form keeps each screen reachable for good while leaving
 *  the expiry logic real. `liveness.spec.ts` asserts every designed state still
 *  resolves to the state it was designed for. */
export const NOW = Date.now();

/** Minutes before NOW, as an ISO string. Negative values are in the future. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

export const USERS: Record<string, User> = {
  deepika: { username: "deepika", displayName: "Deepika", isModerator: false },
  ines: { username: "ines", displayName: "Ines", isModerator: true },
  marcus: { username: "marcus", displayName: "Marcus", isModerator: false },
  tomas: { username: "tomas", displayName: "Tomas", isModerator: false },
  olek: { username: "olek", displayName: "Olek", isModerator: false },
  rafael: { username: "rafael", displayName: "Rafael", isModerator: false },
  priya: { username: "priya", displayName: "Priya", isModerator: false },
  security: {
    username: "security",
    displayName: "Security",
    isModerator: true,
  },
};

/** Who phase 1 resolves as the signed-in viewer. M10 replaces this with Clerk. */
export const VIEWER_USERNAME = "deepika";

export const byteLength = (s: string) => new TextEncoder().encode(s).length;
export const lineCountOf = (s: string) =>
  s.replace(/\n$/, "").split("\n").length;
const sha256 = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");

const preview = (s: string) =>
  s.length <= 10 ? `${s.slice(0, 2)}…` : `${s.slice(0, 4)}…${s.slice(-4)}`;

interface Seed {
  id: string;
  owner?: string;
  title?: string | null;
  language: string;
  languageSource: Paste["languageSource"];
  lineNumbers?: boolean;
  retention: Paste["retention"];
  neverReason?: string | null;
  createdAt: string;
  state: Paste["state"];
  createdVia?: Paste["createdVia"];
  views: number;
  forkedFrom?: string | null;
  removedBy?: Paste["removedBy"];
  request?: number | null;
  /** The text served. For a truncated paste this is only the first `bodyShown` lines. */
  body: string | null;
  /** Overrides for a paste whose real size exceeds what `body` holds. */
  byteSize?: number;
  lineCount?: number;
  bodyShown?: number;
  /** For a purged paste: the hash of the text that is gone. */
  sha256?: string;
  revisions?: Revision[];
  override?: Paste["override"];
}

function make(seed: Seed): Paste {
  const body = seed.body;
  const byteSize = seed.byteSize ?? (body ? byteLength(body) : 0);
  const lineCount = seed.lineCount ?? (body ? lineCountOf(body) : 0);
  const owner = seed.owner ?? "deepika";
  const hash = seed.sha256 ?? (body ? sha256(body) : "");
  // One expression, used by both the revision and the paste: a removed paste was
  // purged early, so its purge date is the removal rather than expiry + 30 days.
  const purgedOn =
    seed.removedBy?.at ?? purgeAfter(seed.createdAt, seed.retention);

  const revisions: Revision[] = seed.revisions ?? [
    {
      no: 1,
      reason: "original",
      sha256: hash,
      byteSize,
      lineCount,
      createdBy: owner,
      createdAt: seed.createdAt,
      purgedAt: seed.state === "purged" ? purgedOn : null,
    },
  ];

  return {
    id: seed.id,
    owner,
    title: seed.title ?? null,
    language: seed.language,
    languageSource: seed.languageSource,
    lineNumbers: seed.lineNumbers ?? false,
    retention: seed.retention,
    neverReason: seed.neverReason ?? null,
    createdAt: seed.createdAt,
    expiresAt: expiresAt(seed.createdAt, seed.retention),
    purgeAfter: purgedOn,
    state: seed.state,
    removedBy: seed.removedBy ?? null,
    forkedFrom: seed.forkedFrom ?? null,
    createdVia: seed.createdVia ?? "web",
    views: seed.views,
    byteSize,
    lineCount,
    body,
    bodyShown: seed.bodyShown ?? (body ? lineCountOf(body) : 0),
    storage: storageFor(byteSize),
    revisions,
    override: seed.override ?? null,
    request: seed.request ?? null,
  };
}

/** The hand-authored fixtures, one per designed state. `liveness.spec.ts` pins each
 *  of these to the state it demonstrates. */
export const DESIGNED_PASTES: readonly Paste[] = [
  // ---- the truncated case: 214 880 lines, only the first 500 served
  make({
    id: "Kp2sM7aJ",
    title: "kubectl logs checkout-7f4",
    language: "log",
    languageSource: "firstline",
    retention: "1d",
    createdAt: minutesAgo(195),
    state: "live",
    createdVia: "cli",
    views: 6,
    body: KUBE_LOG,
    bodyShown: 500,
    byteSize: 21_076_992,
    lineCount: 214_880,
    lineNumbers: true,
  }),
  make({
    id: "R3vKd9Tb",
    title: "payments-api 502s this morning",
    language: "log",
    languageSource: "firstline",
    retention: "1d",
    createdAt: minutesAgo(378),
    state: "live",
    views: 14,
    body: PAY_LOG,
    lineNumbers: true,
  }),
  make({
    id: "Bz8fQ1kW",
    title: "Notes from the incident call",
    language: "plaintext",
    languageSource: "fallback",
    retention: "1d",
    createdAt: minutesAgo(1400),
    state: "live",
    views: 9,
    body: NOTES,
  }),
  // ---- the highlighting-off case: 18 420 lines
  make({
    id: "Tn6yB3xH",
    title: "ingest-worker, the whole run",
    language: "log",
    languageSource: "firstline",
    retention: "30d",
    createdAt: minutesAgo(2740),
    state: "live",
    views: 4,
    body: INGEST_LOG,
    bodyShown: 200,
    byteSize: 1_677_721,
    lineCount: 18_420,
  }),
  make({
    id: "7fK2mQxZ",
    title: "retry_backoff.py",
    language: "python",
    languageSource: "firstline",
    retention: "30d",
    createdAt: minutesAgo(4566),
    state: "live",
    views: 23,
    body: PY,
    lineNumbers: true,
  }),
  // ---- the redacted case: revision 1 purged, revision 2 served, notice permanent
  make({
    id: "Wq8nZ4Fc",
    title: "values-staging.yaml",
    language: "yaml",
    languageSource: "firstline",
    retention: "30d",
    createdAt: minutesAgo(11766),
    state: "redacted",
    views: 96,
    body: YAML_REV2,
    lineNumbers: true,
    revisions: [
      {
        no: 1,
        reason: "original",
        sha256: sha256(YAML_REV1),
        byteSize: byteLength(YAML_REV1),
        lineCount: lineCountOf(YAML_REV1),
        createdBy: "deepika",
        createdAt: minutesAgo(11766),
        purgedAt: minutesAgo(8898),
      },
      {
        no: 2,
        reason: "redaction",
        sha256: sha256(YAML_REV2),
        byteSize: byteLength(YAML_REV2),
        lineCount: lineCountOf(YAML_REV2),
        createdBy: "ines",
        createdAt: minutesAgo(8898),
        purgedAt: null,
      },
    ],
    override: {
      line: 12,
      rule: "password",
      preview: preview(SAMPLE_PASSWORD),
      justification: "Staging only, rotated after this deploy.",
    },
  }),
  // ---- the only "never" paste, carrying its required reason
  make({
    id: "Ld5gP9cV",
    title: "Cohort query for the Q3 review",
    language: "sql",
    languageSource: "explicit",
    retention: "never",
    neverReason: "Linked from the Q3 retention design doc.",
    createdAt: minutesAgo(59330),
    state: "live",
    views: 57,
    body: SQL,
    lineNumbers: true,
    request: 108,
  }),
  // ---- expired: bytes still present, 410 served, a moderator can un-expire
  make({
    id: "Ex4hN8qR",
    title: null,
    language: "bash",
    languageSource: "firstline",
    retention: "30d",
    createdAt: minutesAgo(60788),
    state: "expired",
    views: 31,
    body: BASH,
  }),
  // ---- purged by the sweeper: no bytes, hash survives so a local copy can be checked
  make({
    id: "Pg7wC2mK",
    title: "Flaky test output",
    language: "log",
    languageSource: "scored",
    retention: "1h",
    createdAt: minutesAgo(100860),
    state: "purged",
    views: 2,
    body: null,
    byteSize: byteLength(FLAKY_COPY),
    lineCount: lineCountOf(FLAKY_COPY),
    sha256: sha256(FLAKY_COPY),
  }),
  make({
    id: "Jc3tV6nP",
    title: "Dockerfile for the CI build image",
    language: "dockerfile",
    languageSource: "scored",
    retention: "1y",
    createdAt: minutesAgo(122540),
    state: "live",
    views: 41,
    body: DOCKER,
    lineNumbers: true,
  }),

  // ---- other people's pastes, so /list/:username has more than one owner
  // a fork, with provenance
  make({
    id: "Hx7pL2wE",
    owner: "marcus",
    title: "retry_backoff.py",
    language: "python",
    languageSource: "firstline",
    retention: "30d",
    createdAt: minutesAgo(1730),
    state: "live",
    views: 5,
    body: PY,
    lineNumbers: true,
    forkedFrom: "7fK2mQxZ",
    request: 107,
  }),
  // the paste the open secret request is about: a token on line 88
  make({
    id: "Mx5rT2aB",
    owner: "tomas",
    title: "Staging smoke test output",
    language: "plaintext",
    languageSource: "fallback",
    retention: "30d",
    createdAt: minutesAgo(14252),
    state: "live",
    views: 412,
    body: SMOKE,
    lineNumbers: true,
    request: 110,
  }),
  make({
    id: "Gt6mY3hR",
    owner: "olek",
    title: "Laptop setup notes",
    language: "plaintext",
    languageSource: "fallback",
    retention: "1y",
    createdAt: minutesAgo(83890),
    state: "live",
    views: 3,
    body: LAPTOP,
    request: 109,
  }),
  // ---- removed by a moderator: purged early, 410 names who and why
  make({
    id: "Vy2kH7dL",
    owner: "rafael",
    title: "Export sample for the CSV bug",
    language: "plaintext",
    languageSource: "fallback",
    retention: "30d",
    createdAt: minutesAgo(7165),
    state: "purged",
    removedBy: {
      who: "ines",
      at: minutesAgo(6040),
      reason: "pii",
      request: 106,
    },
    views: 18,
    body: null,
    byteSize: 6_212,
    lineCount: 120,
    // No body to hash: this paste's text never existed in the sample, so the digest is
    // a literal. Every other hash is computed from its body and cannot drift.
    sha256: "9f1dbc0d066464f0551b8f44e8e09f0320e44331acda21d8e197fde1875df94c",
  }),
];

/** Volume, so the list screen can actually be paged.
 *
 *  Deliberately separate from the designed fixtures: those represent distinct *states*
 *  and this represents *quantity*, and mixing the two would make every state assertion
 *  iterate 120 rows to check 14 things. All live, all small, all owned by one person.
 *
 *  Two of them share a `createdAt` on purpose. Keyset pagination orders on
 *  `(createdAt, id)`, and a tie is where a row gets shown twice or skipped at a page
 *  boundary — the fault `keyset-cursor.spec.ts` exists to catch. */
const FILLER_LANGUAGES = [
  "python",
  "typescript",
  "yaml",
  "sql",
  "bash",
  "json",
  "log",
  "plaintext",
] as const;

function fillerPastes(count: number): Paste[] {
  const out: Paste[] = [];
  for (let i = 0; i < count; i += 1) {
    const language = FILLER_LANGUAGES[i % FILLER_LANGUAGES.length];
    const body = `# filler ${i + 1}\nvalue = ${i + 1}\n`;
    // Spaced two hours apart, starting a day back, so they sort below the designed
    // pastes without colliding with them. Entries 40 and 41 share a timestamp.
    const slot = i === 41 ? 40 : i;
    out.push(
      make({
        id: `f${String(i + 1).padStart(3, "0")}aaaa`,
        title: `Scratch ${i + 1}`,
        language,
        languageSource: "scored",
        retention: "1y",
        createdAt: minutesAgo(24 * 60 + slot * 120),
        state: "live",
        views: (i * 7) % 90,
        body,
      }),
    );
  }
  return out;
}

export const PASTES: readonly Paste[] = [
  ...DESIGNED_PASTES,
  ...fillerPastes(110),
];

export const PASTES_BY_ID: Readonly<Record<string, Paste>> = Object.fromEntries(
  PASTES.map((p) => [p.id, p]),
);

const AUDIT: Record<number, AuditEntry[]> = {
  105: [
    {
      at: minutesAgo(11766),
      actor: "deepika",
      kind: "person",
      action: "Saved past a finding",
      detail:
        "Line 12, password, tier 2. Reason given: “Staging only, rotated after this deploy.”",
    },
    {
      at: minutesAgo(8929),
      actor: "security",
      kind: "person",
      action: "Asked for removal",
      detail: "Reason: a secret.",
    },
    {
      at: minutesAgo(8898),
      actor: "ines",
      kind: "person",
      action: "Redacted",
      detail: "Line 12 replaced with «redacted:password».",
    },
    {
      at: minutesAgo(8898),
      actor: "system",
      kind: "instrument",
      action: "Revision 2 written",
      detail: "The link now shows revision 2, with a notice.",
    },
    {
      at: minutesAgo(8898),
      actor: "system",
      kind: "instrument",
      action: "Revision 1 purged",
      detail: "Bytes gone; its SHA-256 stays below.",
    },
  ],
  106: [
    {
      at: minutesAgo(7148),
      actor: "rafael",
      kind: "person",
      action: "Asked for removal",
      detail: "Reason: personal data.",
    },
    {
      at: minutesAgo(6040),
      actor: "ines",
      kind: "person",
      action: "Deleted",
      detail: "Purged now, not 30 days after its expiry on 7 Dec.",
    },
    {
      at: minutesAgo(6040),
      actor: "system",
      kind: "instrument",
      action: "Revision 1 purged",
      detail: "The link answers 410 with a removal notice.",
    },
  ],
  107: [
    {
      at: minutesAgo(1620),
      actor: "marcus",
      kind: "person",
      action: "Asked for removal",
      detail: "Reason: a mistake.",
    },
    {
      at: minutesAgo(1397),
      actor: "ines",
      kind: "person",
      action: "Denied",
      detail: "The paste stays as it is.",
    },
  ],
};

interface RequestSeed extends Omit<
  RemovalRequest,
  "views90" | "audit" | "decidedBy" | "decidedAt" | "note"
> {
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

const REQUEST_SEEDS: RequestSeed[] = [
  {
    id: 110,
    pasteId: "Mx5rT2aB",
    requester: "security",
    relationship: "security",
    reason: "secret",
    justification:
      "Line 88 has a Slack bot token. It was rotated at 09:05; please redact the line and keep the rest.",
    status: "open",
    openedAt: minutesAgo(308),
  },
  {
    id: 109,
    pasteId: "Gt6mY3hR",
    requester: "priya",
    relationship: "manager_of_owner",
    reason: "former_employee",
    justification:
      "Olek left on 31 Oct. The notes include his home address, which he asked us to take down.",
    status: "open",
    openedAt: minutesAgo(1300),
  },
  {
    id: 108,
    pasteId: "Ld5gP9cV",
    requester: "deepika",
    relationship: "owner",
    reason: "mistake",
    justification:
      "I pasted an old version of the query. The design doc should point at a new paste instead.",
    status: "open",
    openedAt: minutesAgo(2955),
  },
  {
    id: 107,
    pasteId: "Hx7pL2wE",
    requester: "marcus",
    relationship: "owner",
    reason: "mistake",
    justification:
      "I meant to change the cap before forking. Please delete my fork.",
    status: "denied",
    openedAt: minutesAgo(1620),
    decidedBy: "ines",
    decidedAt: minutesAgo(1397),
    note: "It’s cited from a code review, so it stays. It expires on 11 Dec; fork again with the new cap.",
  },
  {
    id: 106,
    pasteId: "Vy2kH7dL",
    requester: "rafael",
    relationship: "owner",
    reason: "pii",
    justification:
      "The sample rows are real customer emails, not the test fixture I thought I copied.",
    status: "deleted",
    openedAt: minutesAgo(7148),
    decidedBy: "ines",
    decidedAt: minutesAgo(6040),
    note: "Customer emails. Removed now rather than at expiry.",
  },
  {
    id: 105,
    pasteId: "Wq8nZ4Fc",
    requester: "security",
    relationship: "security",
    reason: "secret",
    justification:
      "Line 12 holds the staging database password. Rotated; please redact.",
    status: "redacted",
    openedAt: minutesAgo(8929),
    decidedBy: "ines",
    decidedAt: minutesAgo(8898),
    note: "Redacted line 12. The rest of the values file is cited from the deploy runbook.",
  },
];

export const REQUESTS: readonly RemovalRequest[] = REQUEST_SEEDS.map(
  (seed) => ({
    ...seed,
    decidedBy: seed.decidedBy ?? null,
    decidedAt: seed.decidedAt ?? null,
    note: seed.note ?? null,
    // Every sample paste is younger than 90 days or was quiet before, so the 90-day
    // figure equals its total. Phase 2 reads it from paste_views.
    views90: PASTES_BY_ID[seed.pasteId].views,
    audit: AUDIT[seed.id] ?? [
      {
        at: seed.openedAt,
        actor: seed.requester,
        kind: "person",
        action: "Asked for removal",
        detail: `Reason: ${seed.reason.replace("_", " ")}.`,
      },
    ],
  }),
);
