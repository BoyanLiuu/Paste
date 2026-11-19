Written for: whoever operates this deployment, including me in six months.

# Scheduled jobs

Two, both in `vercel.json`, both authenticated with `CRON_SECRET` as
`Authorization: Bearer <secret>`. Vercel Cron sends that header automatically from the
project's environment variable; nothing else should be able to call either endpoint.

| Path              | Schedule                        | What it does                                                 | What happens if it stops                                                                                                                                          |
| ----------------- | ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/sweep` | `17 3 * * *` (daily, 03:17 UTC) | Expires lapsed pastes, then purges bytes 30 days past expiry | Nothing breaks for readers. Expiry is enforced on read, so a lapsed paste is already gone to everyone; only the stored state and the byte destruction fall behind |
| `/api/renders`    | `47 4 * * *` (daily, 04:47 UTC) | Fills in missing syntax-highlighting renders                 | Affected pastes show plain text with a banner saying highlighting is not ready. Readable, just not coloured                                                       |

Neither is on a round hour or minute, on purpose: `0 0 * * *` is when every cron on every
platform fires, and sharing that minute with the rest of the world is a way to get rate
limited by your own database.

**Both are daily, which is the schedule that works on every Vercel plan.** Hobby limits
how many cron jobs a project may have and how often they run; an hourly schedule is a paid
feature, and a cron that is silently rejected or downgraded is worse than one that is
obviously infrequent. Confirm the current limits against your plan before changing either,
rather than taking this paragraph's word for it.

The render backfill does not need to be frequent. A paste missing its render shows plain
text with a banner saying so — readable, just not coloured — so a day's delay costs colour
and nothing else. If that becomes the common case rather than the rare one, the thing to
fix is whatever is making save-time renders fail, not the schedule.

## Why the sweeper can be late

This is the part worth understanding before changing the schedule. **Expiry is
authoritative on read** (ARCHITECTURE §6.3): every request recomputes whether a paste has
lapsed, so a paste whose retention ran out four seconds ago answers 410 immediately,
whether or not any job has touched the row. The sweeper only converges the `state` column
and destroys bytes.

That is what makes a daily tick safe. If expiry were enforced by the sweeper, a late cron
run would be a content leak, and this would have to run every minute and be monitored like
one.

## Reading the summary

Both endpoints return JSON and log one line. The sweeper's:

```
sweep: 500 expired, 0 purged, 0 failed, more=true, 47ms
```

- **`more=true`** means it ran out of budget with work left. Normal while a backlog
  drains; the next tick continues. Persistently true across many days means the backlog is
  growing faster than a daily tick clears it — raise `SWEEP_BUDGET_MS` or the schedule.
- **`failed`** lists paste ids whose purge did not complete. Their leases lapse and the
  next tick retries them, so a transient storage error self-heals. The same id appearing
  for days is a real fault.
- **`purged: 0` with pastes long expired** is expected: the purge window is 30 days past
  expiry, and a moderator can restore inside it.

## Phase C, which is not scheduled

`src/lib/server/orphans.sql` lists storage objects with no revision pointing at them. Run
it weekly by hand and **read the result before deleting anything**. It is deliberately not
automated: a growing list is a bug in the sweeper's ordering, not a storage-tidiness
problem, and automatic deletion would hide the cause while the storage bill grew.

Expect zero rows.

## Environment

```
CRON_SECRET          required by both endpoints; they return 503 without it
SWEEP_BUDGET_MS      optional, default 240000, capped at 290000
SUPABASE_URL         required once any paste exceeds 512 KB
SUPABASE_SERVICE_ROLE_KEY
```

Both endpoints **fail closed** when `CRON_SECRET` is unset — the sweeper destroys data and
the render backfill invokes a highlighter, so an unauthenticated version of either is a
remote button worth not having.
