-- Project 25 · Paste · initial schema.
--
-- Everything lives in the `paste` schema: the Supabase project is shared with other
-- apps and the schema is the isolation boundary (ARCHITECTURE Appendix B).
--
-- The first 200 lines are generated from prisma/schema.prisma by `prisma migrate diff`.
-- Everything after the marker is hand-written, because Prisma cannot express it — and
-- that part is the point of this migration, not an addendum to it.
--
-- Applied with `migrate deploy` only. Dev and production share this schema, so
-- `migrate dev` and `migrate reset` are never run: both can drop live data.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "paste";

-- CreateTable
CREATE TABLE "paste"."users" (
    "id" UUID NOT NULL,
    "clerk_user_id" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "is_moderator" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."pastes" (
    "id" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT,
    "language" TEXT NOT NULL,
    "language_source" TEXT NOT NULL,
    "line_numbers" BOOLEAN NOT NULL DEFAULT false,
    "retention_code" TEXT NOT NULL,
    "never_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "purge_after" TIMESTAMPTZ(6),
    "state" TEXT NOT NULL,
    "head_revision_id" UUID,
    "forked_from" TEXT,
    "created_via" TEXT NOT NULL,
    "created_ip_hash" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pastes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."paste_revisions" (
    "id" UUID NOT NULL,
    "paste_id" TEXT NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "line_count" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "body_text" TEXT,
    "storage_key" TEXT,
    "reason" TEXT NOT NULL,
    "scan_state" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),

    CONSTRAINT "paste_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."paste_renders" (
    "revision_id" UUID NOT NULL,
    "theme" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "shiki_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paste_renders_pkey" PRIMARY KEY ("revision_id","theme")
);

-- CreateTable
CREATE TABLE "paste"."secret_findings" (
    "id" UUID NOT NULL,
    "paste_id" TEXT NOT NULL,
    "revision_id" UUID,
    "rule_id" TEXT NOT NULL,
    "tier" SMALLINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "col_start" INTEGER NOT NULL,
    "col_end" INTEGER NOT NULL,
    "match_preview" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "override_justification" TEXT,
    "acknowledged_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."deletion_requests" (
    "id" SERIAL NOT NULL,
    "paste_id" TEXT NOT NULL,
    "requester_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "payload" JSONB,
    "dedupe_key" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paste"."rate_buckets" (
    "user_id" UUID NOT NULL,
    "minute_tokens" INTEGER NOT NULL DEFAULT 20,
    "minute_refilled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day_count" INTEGER NOT NULL DEFAULT 0,
    "day_started_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_buckets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "paste"."paste_views" (
    "paste_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "n" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "paste_views_pkey" PRIMARY KEY ("paste_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "paste"."users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "paste"."users"("username");

-- CreateIndex
CREATE INDEX "pastes_owner_id_created_at_idx" ON "paste"."pastes"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "paste_revisions_paste_id_revision_no_key" ON "paste"."paste_revisions"("paste_id", "revision_no");

-- CreateIndex
CREATE INDEX "secret_findings_paste_id_idx" ON "paste"."secret_findings"("paste_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_subject_type_subject_id_action_dedupe_key_key" ON "paste"."audit_log"("subject_type", "subject_id", "action", "dedupe_key");

-- AddForeignKey
ALTER TABLE "paste"."pastes" ADD CONSTRAINT "pastes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "paste"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."pastes" ADD CONSTRAINT "pastes_forked_from_fkey" FOREIGN KEY ("forked_from") REFERENCES "paste"."pastes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."paste_revisions" ADD CONSTRAINT "paste_revisions_paste_id_fkey" FOREIGN KEY ("paste_id") REFERENCES "paste"."pastes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."paste_revisions" ADD CONSTRAINT "paste_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "paste"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."paste_renders" ADD CONSTRAINT "paste_renders_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "paste"."paste_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."secret_findings" ADD CONSTRAINT "secret_findings_paste_id_fkey" FOREIGN KEY ("paste_id") REFERENCES "paste"."pastes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."secret_findings" ADD CONSTRAINT "secret_findings_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "paste"."paste_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."secret_findings" ADD CONSTRAINT "secret_findings_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "paste"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."deletion_requests" ADD CONSTRAINT "deletion_requests_paste_id_fkey" FOREIGN KEY ("paste_id") REFERENCES "paste"."pastes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."deletion_requests" ADD CONSTRAINT "deletion_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "paste"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."deletion_requests" ADD CONSTRAINT "deletion_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "paste"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "paste"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."rate_buckets" ADD CONSTRAINT "rate_buckets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "paste"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paste"."paste_views" ADD CONSTRAINT "paste_views_paste_id_fkey" FOREIGN KEY ("paste_id") REFERENCES "paste"."pastes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Hand-written from here. Prisma cannot express any of it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Exactly one body pointer, unless the revision has been purged.
--
-- A revision holds its bytes either inline (<= 512 KB) or as an object key, never
-- both and never neither. The purge is the one exception: it nulls both and stamps
-- purged_at, which is also the only body mutation the trigger below permits.
-- ---------------------------------------------------------------------------
ALTER TABLE "paste"."paste_revisions"
  ADD CONSTRAINT "paste_revisions_one_body_pointer"
  CHECK (
    "purged_at" IS NOT NULL
    OR (("body_text" IS NULL) <> ("storage_key" IS NULL))
  );

-- ---------------------------------------------------------------------------
-- 2. THE IMMUTABILITY TRIGGER (ARCHITECTURE §6.3).
--
-- This is what turns "the bytes are immutable" from a sentence in a document into
-- something the database enforces. A trigger rather than revoking column privileges,
-- because Prisma connects as a role that owns these tables and could grant the
-- privilege back to itself; a trigger holds whatever role is connected.
--
-- A future feature that needs to rewrite a body has to drop this in a committed
-- migration — exactly the amount of friction that decision deserves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "paste"."revisions_are_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Identity and content facts never change, full stop.
  IF NEW."paste_id"    IS DISTINCT FROM OLD."paste_id"
  OR NEW."revision_no" IS DISTINCT FROM OLD."revision_no"
  OR NEW."sha256"      IS DISTINCT FROM OLD."sha256"
  OR NEW."byte_size"   IS DISTINCT FROM OLD."byte_size"
  OR NEW."line_count"  IS DISTINCT FROM OLD."line_count"
  THEN
    RAISE EXCEPTION
      'paste_revisions: revision % is immutable (attempted to change identity or size)',
      OLD."id";
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

CREATE TRIGGER "paste_revisions_immutable"
  BEFORE UPDATE ON "paste"."paste_revisions"
  FOR EACH ROW EXECUTE FUNCTION "paste"."revisions_are_immutable"();

-- ---------------------------------------------------------------------------
-- 3. Partial indexes for the sweeper (§6.4).
--
-- Partial on purpose. The expiry sweep must not scan `never` pastes or ones it has
-- already expired, and the purge sweep must not scan anything still live. A full index
-- on expires_at would be larger and would make both sweeps read rows they will skip.
-- ---------------------------------------------------------------------------
CREATE INDEX "pastes_expiry_sweep"
  ON "paste"."pastes" ("expires_at")
  WHERE "state" = 'live' AND "expires_at" IS NOT NULL;

CREATE INDEX "pastes_purge_sweep"
  ON "paste"."pastes" ("purge_after")
  WHERE "state" = 'expired';

-- The moderation queue, which must stay cheap with 40 000 closed requests (N8).
CREATE INDEX "deletion_requests_open"
  ON "paste"."deletion_requests" ("created_at")
  WHERE "status" = 'open';

-- Forks of a given paste, for the view page's provenance panel.
CREATE INDEX "pastes_forked_from"
  ON "paste"."pastes" ("forked_from")
  WHERE "forked_from" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security on every table, with NO policies.
--
-- Defence in depth, not the authorization model. The role Prisma connects as owns
-- these tables and bypasses RLS, so application queries are unaffected — while a
-- leaked Supabase anon key reads nothing. Ownership is enforced in the service layer
-- with an explicit WHERE; this is the backstop for when that is wrong.
--
-- Verified after enabling rather than assumed: rls.spec.ts asserts the anon key reads
-- zero rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "paste"."users"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."pastes"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."paste_revisions"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."paste_renders"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."secret_findings"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."audit_log"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."rate_buckets"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paste"."paste_views"       ENABLE ROW LEVEL SECURITY;
