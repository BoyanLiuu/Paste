-- Creating a paste without an account (M15, §3).
--
-- A GUEST IS A `users` ROW WITH `clerk_user_id IS NULL`. That column has been nullable since
-- the init migration, whose own comment says "nullable from the first migration, and unused
-- until M10 — auth arriving later must not need a migration of its own." A user with no
-- Clerk identity is therefore an existing, documented state rather than a new concept, and
-- reusing it is what keeps this migration to one column:
--
--   * `pastes.owner_id` stays NOT NULL, so every owner join is untouched
--   * the removal-request relationship check keeps working — a guest owns their paste
--   * `audit_log` gets a real actor instead of a null
--   * `rate_buckets` gets a row per guest for free, because the key is a user id
--   * `roleOf` maps a guest to `member`, so the capability table needs NO change
--
-- THE COOKIE HOLDS THIS TOKEN, NEVER THE UUID. Putting an internal identifier in a cookie
-- turns it into a bearer credential: one leak into a log, a screenshot or an error page and
-- someone else owns that guest's pastes. The token is a credential by design, so it is
-- generated from a CSPRNG, unique, and the only thing the cookie carries.
ALTER TABLE "paste"."users" ADD COLUMN "guest_token" TEXT;

-- Unique so a token identifies at most one guest, and PARTIAL so the overwhelming majority
-- of rows — every signed-in account, all of them NULL here — cost nothing to index. Postgres
-- would allow many NULLs in a plain unique index too; the partial index is about size.
CREATE UNIQUE INDEX "users_guest_token_key"
  ON "paste"."users" ("guest_token")
  WHERE "guest_token" IS NOT NULL;

-- A guest has a token and no Clerk id; an account has a Clerk id and no token. Enforced
-- rather than assumed, because the two are what `getViewer` uses to tell them apart: a row
-- with both would be a guest that is also an account, and whichever check ran first would
-- win silently.
--
-- `M15`: a row with NEITHER is still legal, which is deliberate — the test harness and the
-- `shots-demo` screenshot owner are exactly that, and `userIdFor`'s create arm has minted
-- such rows since M1.
ALTER TABLE "paste"."users"
  ADD CONSTRAINT "users_guest_xor_account"
  CHECK (NOT ("guest_token" IS NOT NULL AND "clerk_user_id" IS NOT NULL));
