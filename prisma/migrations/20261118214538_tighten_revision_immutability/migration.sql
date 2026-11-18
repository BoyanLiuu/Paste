-- Close two holes in the first migration, both found by probing the applied schema
-- rather than by reading it (ARCHITECTURE Appendix H).
--
-- A separate migration because the first one is already applied and Prisma records its
-- checksum: editing it in place makes `migrate deploy` report a modified migration and
-- refuse to run.

-- ---------------------------------------------------------------------------
-- 1. The trigger was a DENYLIST where the design is an ALLOWLIST.
--
-- Appendix D's prose says "superseded_at, purged_at and scan_state are the whole allowed
-- update vocabulary". The SQL printed beside it — which this project copied — instead
-- named five columns that may not change, which silently permitted four that should
-- never change: `id`, `created_at`, `created_by` and `reason`. Measured, not assumed:
-- all four accepted an UPDATE against the applied schema.
--
-- `created_by` is the one that matters. It is the revision's attribution, cited by the
-- audit trail, and it was rewritable — so "who stored these bytes" was a question the
-- database would answer differently depending on who asked last.
--
-- Inverting to a real allowlist also fixes the version of this bug that has not happened
-- yet: a column added by a later migration is immutable by default instead of quietly
-- writable, which a hand-maintained denylist can never promise.
CREATE OR REPLACE FUNCTION "paste"."revisions_are_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- The whole allowed update vocabulary, plus the two body pointers, which have their own
  -- rule below because they may change in exactly one shape.
  mutable text[] := ARRAY[
    'superseded_at', 'purged_at', 'scan_state', 'body_text', 'storage_key'
  ];
  old_fixed jsonb := to_jsonb(OLD) - mutable;
  new_fixed jsonb := to_jsonb(NEW) - mutable;
  changed text;
BEGIN
  IF old_fixed IS DISTINCT FROM new_fixed THEN
    -- Name the offending column. "This row is immutable" sends whoever is paged to read
    -- the trigger source to find out which of fourteen columns they touched.
    SELECT string_agg(key, ', ' ORDER BY key) INTO changed
      FROM jsonb_each(old_fixed)
     WHERE value IS DISTINCT FROM new_fixed -> key;

    RAISE EXCEPTION
      'paste_revisions: revision % is immutable (attempted to change: %)',
      OLD."id", changed;
  END IF;

  -- The body may change in exactly one way: both pointers to NULL, as a purge.
  IF (NEW."body_text"   IS DISTINCT FROM OLD."body_text"
   OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key")
  AND NOT (NEW."body_text" IS NULL
       AND NEW."storage_key" IS NULL
       AND NEW."purged_at" IS NOT NULL)
  THEN
    RAISE EXCEPTION
      'paste_revisions: revision % may only be purged, not rewritten', OLD."id";
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The CHECK short-circuited on `purged_at IS NOT NULL`.
--
-- `purged_at IS NOT NULL OR (exactly one pointer)` is satisfied by a row that is purged
-- AND still holds its bytes, so a revision could be born purged with a body attached —
-- a tombstone rendering over content that was never destroyed. No code path did this; the
-- constraint simply did not say what it appeared to say.
--
-- Stated now as the two cases it always meant: purged means both pointers gone, and
-- live means exactly one of them present.
ALTER TABLE "paste"."paste_revisions"
  DROP CONSTRAINT "paste_revisions_one_body_pointer";

ALTER TABLE "paste"."paste_revisions"
  ADD CONSTRAINT "paste_revisions_one_body_pointer"
  CHECK (
    CASE
      WHEN "purged_at" IS NOT NULL
        THEN "body_text" IS NULL AND "storage_key" IS NULL
      ELSE ("body_text" IS NULL) <> ("storage_key" IS NULL)
    END
  );
