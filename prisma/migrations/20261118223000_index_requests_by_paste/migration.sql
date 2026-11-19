-- Removal requests BY PASTE, for the view page and the list row.
--
-- M11 made every paste read carry its visible removal requests: the 410 receipt has to
-- name the moderator who destroyed the bytes (§6.3), and the list row shows an "under
-- review" badge. Both read `deletion_requests` keyed by `paste_id`.
--
-- Postgres creates no index for a foreign key, so without this the join is a sequential
-- scan of a table N8 sizes at 40 000 rows — on the hot read path, once per paste.
--
-- Partial, matching the mapper's `where` exactly. A denied request is on no screen, and
-- excluding them keeps the index proportional to what is displayed rather than to how
-- often someone complained about a paste. `deletion_requests_open` stays: it orders the
-- whole queue by `created_at` and this one cannot serve that scan.
CREATE INDEX "deletion_requests_by_paste"
  ON "paste"."deletion_requests" ("paste_id", "status")
  WHERE "status" IN ('open', 'deleted');
