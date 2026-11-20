-- Rate limiting keyed on the caller's address, as well as on their account (M14, §4 stage 2).
--
-- WHY A SECOND TABLE RATHER THAN A WIDER FIRST ONE. `rate_buckets` is keyed on
-- `user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, and that foreign key is
-- doing real work: deleting a user takes their bucket with them. An IP has no row to
-- reference and no owner to be deleted with, so putting both in one table would mean
-- dropping the key, losing the cascade, and widening the primary key to text for every
-- account — a migration of the existing hot path to accommodate a new one.
--
-- The two also differ in lifecycle, which is the stronger reason. A user bucket is bounded
-- by the number of accounts and never needs pruning. An IP bucket is bounded by the number
-- of addresses that have ever made a request, which grows without limit and has to be swept.
-- One table would have to carry a nullable `user_id`, a `kind` discriminator and a partial
-- index per kind to express that difference. Two tables express it by existing.
--
-- WHAT IS DELIBERATELY NOT HERE: a foreign key, because there is nothing to point at; and a
-- `created_at`, because `minute_refilled_at` already dates the row and a sweeper can use it.
CREATE TABLE "paste"."ip_buckets" (
  -- sha256 of (stable salt + the limit scope), hex. NEVER the address: see
  -- `lib/http/client-ip.ts`, which explains why an unsalted hash of an IPv4 address is a
  -- reversible encoding rather than a pseudonym.
  --
  -- The scope is the whole address for IPv4 and the /64 for IPv6, so one customer's entire
  -- v6 allocation shares one row. Keying on a full v6 address would let one actor rotate
  -- through 2^64 keys inside their own network for free.
  "ip_hash" TEXT NOT NULL,

  -- The same lazy token bucket `rate_buckets` holds, column for column, so one statement in
  -- `rate.ts` can serve both tables. Divergence here means two implementations of the
  -- refill arithmetic, and the one that is not on the hot path is the one that rots.
  "minute_tokens" INTEGER NOT NULL DEFAULT 20,
  "minute_refilled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "day_count" INTEGER NOT NULL DEFAULT 0,
  "day_started_at" DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,

  CONSTRAINT "ip_buckets_pkey" PRIMARY KEY ("ip_hash")
);

-- The sweeper's access path. An IP bucket is only worth keeping while it holds a debt: once
-- it has refilled, the row says nothing a fresh row would not. Nothing sweeps yet — this
-- index is what makes that job a range scan rather than a full table scan when it lands,
-- and the table is empty today so creating it now is free.
CREATE INDEX "ip_buckets_stale" ON "paste"."ip_buckets" ("minute_refilled_at");

-- RLS, matching every other table in this schema (§6.5, init migration's closing block).
--
-- CAUGHT BY `rls.spec.ts` RATHER THAN REMEMBERED. That test asserts row level security is
-- enabled on EVERY table in `paste` with zero policies, so adding a table without this line
-- failed the suite — which is the whole reason it enumerates tables instead of listing the
-- ones it knows about. A new table is exactly when this gets forgotten.
--
-- Defence in depth rather than the authorization model: the role Prisma connects as owns
-- these tables and bypasses RLS, so the limiter is unaffected. What it buys is that a leaked
-- Supabase anon key cannot read the bucket table — which would otherwise hand out a list of
-- every IP hash that has made a request, and let anyone measure how close a given source is
-- to its limit.
ALTER TABLE "paste"."ip_buckets" ENABLE ROW LEVEL SECURITY;
