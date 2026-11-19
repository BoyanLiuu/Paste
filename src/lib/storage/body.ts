// The only module that knows a bucket exists (ARCHITECTURE §6.2, §6.4).
//
// Bodies at or under 512 KB live in a Postgres `text` column; above it they live in a
// storage object and the revision keeps a `storage_key`. Every other module asks this one
// to put bytes somewhere and get them back, so the threshold, the key format and the
// client all have exactly one home. The M6 `CHECK` enforces the invariant underneath:
// exactly one body pointer, unless the revision has been purged.
//
// SERVER ONLY, and the bucket is PRIVATE. The browser never talks to Supabase (§6.5) —
// bodies are served through `/raw` and `/dl` so the same expiry and redaction rules apply
// to the bytes as to the page. A public bucket would route around every one of them.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { OBJECT_STORAGE_BYTES } from "@/lib/render/thresholds";

export const BUCKET = "paste-bodies";

// Where a revision's bytes go is `storageFor` in thresholds.ts, and this module
// deliberately does not define its own copy. It had one — `storageForBytes`, identical
// line for line — which is the same duplication the liveness rule had just been collapsed
// out of, reintroduced in the same session. One decision, one definition.
//
// The threshold is in BYTES, not characters: UTF-8 spends up to four bytes per code point,
// so a character count lets roughly 2 MB of CJK through a 512 KB gate.

/**
 * The object key for a revision.
 *
 * Keyed on the revision's uuid, not the paste's id. A revision's bytes are immutable (§6.3)
 * so the key never has to be rewritten, and a supersession writes a new object rather than
 * overwriting one — which is what keeps "the bytes behind this key never change" true for
 * the orphan report in phase C to rely on.
 */
export function bodyKey(revisionId: string): string {
  return `revisions/${revisionId}`;
}

export class StorageNotConfigured extends Error {
  constructor() {
    super(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to store a body over " +
        `${OBJECT_STORAGE_BYTES} bytes. See .env.example.`,
    );
    this.name = "StorageNotConfigured";
  }
}

/** Whether object storage is available. Callers use this to fail a large create loudly
 *  rather than silently storing an over-threshold body inline. */
export function storageConfigured(): boolean {
  return (
    (process.env.SUPABASE_URL ?? "") !== "" &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") !== ""
  );
}

let client: SupabaseClient | null = null;

function storage() {
  if (!storageConfigured()) throw new StorageNotConfigured();

  client ??= createClient(
    process.env.SUPABASE_URL!,
    // The SERVICE ROLE key, which bypasses RLS and is never sent to a browser. It is read
    // from a non-`NEXT_PUBLIC_` variable for that reason — the prefix is the only thing
    // standing between this and a public credential.
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  return client.storage.from(BUCKET);
}

/** Reset the memoised client, for tests that change the environment. */
export function resetStorageClient(): void {
  client = null;
}

/**
 * Write a body and return its key.
 *
 * `upsert: false`. The key contains a fresh uuid, so a collision means something is
 * reusing a revision id — which would silently replace one revision's bytes with
 * another's, and is exactly the kind of thing that should fail rather than succeed.
 */
export async function putBody(
  revisionId: string,
  body: string,
): Promise<string> {
  const key = bodyKey(revisionId);
  const { error } = await storage().upload(key, body, {
    contentType: "text/plain; charset=utf-8",
    upsert: false,
  });

  if (error !== null) {
    throw new Error(`could not store body for revision ${revisionId}`, {
      cause: error,
    });
  }

  return key;
}

export class BodyUnavailable extends Error {
  constructor(key: string, cause: unknown) {
    super(`could not read the stored body ${key}`);
    this.name = "BodyUnavailable";
    this.cause = cause;
  }
}

/**
 * Read a body back. THROWS if it cannot.
 *
 * This returned null on any failure at first, which reads as the forgiving choice and is
 * the dangerous one: a 404, an expired key, a network timeout and a misconfigured bucket
 * all became "no body", the read path rendered the paste with an empty `<pre>`, and the
 * reader was told — confidently, with a 200 — that the snippet was empty. A transient
 * outage producing a wrong answer is worse than one producing an error, because nobody
 * retries an answer.
 *
 * There is no legitimate "object missing" case to be forgiving about. A purge NULLs the
 * `storage_key` in the same statement that it deletes the object, so a revision that still
 * holds a key is a revision whose object should exist — and the create path uploads before
 * inserting, so a committed revision never pointed at an object that was not there. A
 * missing object here is always an anomaly, and a 500 is the honest report of one.
 */
export async function getBody(key: string): Promise<string> {
  const { data, error } = await storage().download(key);
  if (error !== null) throw new BodyUnavailable(key, error);
  if (data === null) throw new BodyUnavailable(key, "no data returned");
  return data.text();
}

/**
 * Delete an object. Returns true when the object is gone, including when it never existed.
 *
 * IDEMPOTENT BY DESIGN, and §6.4 depends on it. Phase B deletes the object before nulling
 * the key, so a killed invocation re-runs the delete on a key whose object is already
 * gone. If that reported failure, the sweeper could never finish the row — it would retry
 * forever on work that was already done.
 */
export async function deleteBody(key: string): Promise<boolean> {
  const { error } = await storage().remove([key]);
  // Supabase returns no error for a missing key, but a 404 from a different storage
  // backend must read the same way for the ordering guarantee above to hold.
  if (error === null) return true;

  const status = (error as { statusCode?: string | number }).statusCode;
  return String(status) === "404" || /not.?found/i.test(error.message);
}
