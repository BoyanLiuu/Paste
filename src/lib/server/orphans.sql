-- PHASE C — the orphan backstop (ARCHITECTURE §6.4). REPORT ONLY.
--
-- Run weekly, by hand or from a dashboard. It deletes nothing, and that is the design.
--
-- Supabase Storage has no lifecycle rules, so there is no bucket-level sweeper to fall
-- back on. This is better than one would be: the object index is a table in the same
-- database as the rows that reference it, so the join is exact rather than a guess based
-- on key naming.
--
-- WHY REPORT RATHER THAN DELETE. An unexpectedly long list is not a storage problem, it is
-- a bug in phase B — the object delete is supposed to happen before the key is nulled, so
-- a steady trickle of orphans means that ordering has been broken or an upload is failing
-- after its row is written. Deleting them automatically would make the symptom disappear
-- while the cause continued, and the next clue would be a storage bill. Reading the list
-- first is how the bug gets found.
--
-- The 7-day floor is what makes the report trustworthy. The create path uploads the object
-- BEFORE inserting the revision that names it, so a brand-new object legitimately has no
-- row for the few milliseconds in between — and a crash in that window leaves a genuine
-- orphan. Without the floor every in-flight upload would appear here and the list would
-- be noise.

SELECT
  o.name                                   AS storage_key,
  o.created_at,
  now() - o.created_at                     AS age,
  (o.metadata ->> 'size')::bigint          AS bytes
FROM storage.objects o
LEFT JOIN paste.paste_revisions r
       ON r.storage_key = o.name
WHERE o.bucket_id = 'paste-bodies'
  AND o.created_at < now() - interval '7 days'
  AND r.id IS NULL
ORDER BY o.created_at;

-- Expected result: zero rows.
--
-- A handful of old orphans is a historical crash. A list that grows week on week is phase
-- B writing in the wrong order, or a create path uploading objects for rows that never
-- commit. Investigate before deleting anything, and if deletion is the answer, do it with
-- the list in hand rather than with a query that selects and removes in one step.
