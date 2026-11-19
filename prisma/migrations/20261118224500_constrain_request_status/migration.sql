-- The removal request's status domain, enforced by the database.
--
-- WHY THIS EXISTS: the decision path wrote `` `${action}ed` ``, so a delete stored
-- "deleteed". The column accepted it, the queue only ever filters `status = 'open'`, and
-- the conflict tests assert `status <> 'open'` — so the typo survived into the one column
-- a later read keys on, and the 410 receipt for a destroyed paste reported it as having
-- lapsed on a date in the future. Four spellings of this column exist in the code; the
-- table is where they have to agree.
--
-- WRITTEN AS A CASE rather than as `status IN (…) AND (…)`, which is the M6 lesson: a
-- CHECK built from ANDed conditions short-circuits in whichever way makes the row pass,
-- and the one that tightened revision immutability had to be restated for exactly this.
-- One branch per status, and an unknown status falls to `false`.
--
-- `decided_by` is deliberately NOT required on a decided row: it is SET NULL when a
-- moderator's account is deleted, and the decision still happened. `decided_at` IS
-- required, because the receipt prints it and the alternative is printing an epoch date.
ALTER TABLE "paste"."deletion_requests"
  ADD CONSTRAINT "deletion_requests_status_valid"
  CHECK (
    CASE "status"
      WHEN 'open' THEN
        "decided_at" IS NULL
        AND "decided_by" IS NULL
        AND "decision_note" IS NULL
      WHEN 'redacted' THEN "decided_at" IS NOT NULL AND "decision_note" IS NOT NULL
      WHEN 'deleted'  THEN "decided_at" IS NOT NULL AND "decision_note" IS NOT NULL
      WHEN 'denied'   THEN "decided_at" IS NOT NULL AND "decision_note" IS NOT NULL
      ELSE false
    END
  );
