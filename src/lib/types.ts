// The shapes every screen reads. Phase 2 replaces the fixture implementation behind
// the service layer with Prisma; these types do not change, which is the point of
// ARCHITECTURE Appendix C.

export type RetentionCode = "1h" | "1d" | "30d" | "1y" | "never";

/** A paste's lifecycle position. The read path recomputes expiry per request and may
 *  answer 410 while this still says "live" — see ARCHITECTURE §6.3. */
export type PasteState = "live" | "expired" | "purged" | "redacted";

/** Which rung of the detection ladder answered. Shown next to the language so a wrong
 *  guess is visibly a guess, and instrumented as the accuracy signal (§A.1). */
export type LanguageSource =
  "explicit" | "filename" | "firstline" | "scored" | "fallback";

export type Storage = "postgres" | "object";

export interface User {
  username: string;
  displayName: string;
  isModerator: boolean;
}

export interface Revision {
  no: number;
  reason: "original" | "redaction";
  /** Survives the purge. It is what lets a tombstone prove what used to be there. */
  sha256: string;
  byteSize: number;
  lineCount: number;
  createdBy: string;
  createdAt: string;
  /** Set once the bytes are gone. The only legal body mutation (Appendix D). */
  purgedAt: string | null;
}

export interface Finding {
  rule: string;
  label: string;
  tier: 1 | 2 | 3;
  line: number;
  colStart: number;
  colEnd: number;
  /** First four and last four characters only. Never the secret itself (§6.1). */
  preview: string;
}

/** A tier-2/3 finding the creator saved past, with the justification they typed. */
export interface Override {
  line: number;
  rule: string;
  preview: string;
  justification: string;
}

export interface RemovedBy {
  who: string;
  at: string;
  reason: RemovalReason;
  request: number;
}

export interface Paste {
  id: string;
  owner: string;
  title: string | null;
  language: string;
  languageSource: LanguageSource;
  /** A stored property of the snippet, not a viewer preference, so `#L42` means one
   *  thing for every reader (§6.2). */
  lineNumbers: boolean;
  retention: RetentionCode;
  /** Required when retention is "never"; shown on the view page. */
  neverReason: string | null;
  createdAt: string;
  expiresAt: string | null;
  purgeAfter: string | null;
  state: PasteState;
  removedBy: RemovedBy | null;
  forkedFrom: string | null;
  /** How it arrived. `"cli"` was a third option until the command-line client was
   *  dropped; the form sends JSON and anything else sends a raw body, which is the only
   *  distinction left that is observable rather than self-reported. */
  createdVia: "web" | "api";
  views: number;
  byteSize: number;
  lineCount: number;
  /** null once purged. For a body over the truncation threshold this holds only the
   *  first `bodyShown` lines, while byteSize and lineCount describe the whole thing. */
  body: string | null;
  /** How many of `lineCount` lines `body` actually contains. */
  bodyShown: number;
  storage: Storage;
  revisions: Revision[];
  /** The tier-2/3 finding its creator saved past, or null. `| null` rather than
   *  optional because undefined and null serialise differently across the RSC
   *  boundary, and a component testing `=== null` would never match. */
  override: Override | null;
  /** The open or decided removal request covering this paste, if any. */
  request: number | null;
}

export type RemovalReason =
  "secret" | "pii" | "former_employee" | "mistake" | "other";

export type Relationship = "owner" | "manager_of_owner" | "security" | "other";

/** `"withdrawn"` was here and is gone: nothing ever wrote it, no screen offers it, and
 *  M11's `CHECK` on the column rejects it. Keeping a value the database refuses would mean
 *  the type described a state the system cannot reach (Appendix G). */
export type RequestStatus = "open" | "redacted" | "deleted" | "denied";

export interface AuditEntry {
  at: string;
  actor: string;
  /** "person" for a human act, "instrument" for one the system performed. */
  kind: "person" | "instrument";
  action: string;
  detail: string;
}

export interface RemovalRequest {
  id: number;
  pasteId: string;
  requester: string;
  relationship: Relationship;
  reason: RemovalReason;
  justification: string;
  status: RequestStatus;
  openedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  /** Views over the last 90 days — the whole decision input for a moderator (§6.3). */
  views90: number;
  audit: AuditEntry[];
}

/** Keyset cursor for /list/:username, encoded as "<createdAt>,<id>" (§3). */
export type Cursor = string;

export interface Page<T> {
  items: T[];
  next: Cursor | null;
  total: number;
}

/** Resolved once per request. Phase 1 returns a fixture; M10 returns Clerk's user. */
export type Viewer = { kind: "anon" } | { kind: "user"; user: User };

/** Every mutation names one. The denial table is empty in phase 1 and filled at M10,
 *  so gating becomes a data change rather than a rewrite (Appendix C, rule 3). */
export type Capability =
  | "paste:create"
  | "paste:fork"
  | "removal:request"
  | "removal:decide"
  | "retention:extended";
