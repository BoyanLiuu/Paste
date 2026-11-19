import { expect, test } from "@playwright/test";

import { newPasteId } from "../../src/lib/ids";

// The matcher mistake that breaks the premise (ARCHITECTURE §2, §3).
//
// Reads are public and writes require a session. That asymmetry is the product, not a
// default — and the way it dies is a middleware matcher that protects one route too many.
// Signed out, every read below must work; a redirect to /sign-in is the failure.
//
// AN END-TO-END TEST AND NOT A UNIT ONE, deliberately. What is under test is the
// composition: Clerk's middleware, the proxy's status rewrite, PPR's static shell and the
// CSP header all interact, and each has already produced a bug the others hid. Unit tests
// of `viewRoute` passed while the composed stack returned 500 for every 404 and 410 —
// twice, for different reasons, before this file existed.
//
// These run with NO SESSION. Playwright gives each test a fresh context, so signed out is
// the default rather than something to arrange.
//
// FIXTURES ARE SEEDED THROUGH THE DATABASE, not through the API. The first version of this
// file created them with `POST /api/pastes`, which stopped working the moment M10 wired
// Clerk: signed out, that endpoint now answers 401, correctly. §3 promises a Bearer token
// for the CLI as the second way in, and no milestone builds it yet — so there is currently
// no way to create a paste without a browser session, which is worth knowing and is not
// this test's problem to solve.

import { Client } from "pg";

// RAW `pg`, NOT THE PRISMA CLIENT. Importing the generated client here failed with
// "Cannot use 'import.meta' outside a module": Playwright's TypeScript loader does not
// treat the generated ESM as a module, and the suite reported "No tests found" — a run
// that executed nothing and exited 1. These fixtures are four INSERTs; they do not need
// an ORM.

async function withDb<T>(body: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

interface Seeded {
  id: string;
  body: string;
  owner: string;
}

/**
 * Usernames THIS worker created, so teardown removes only those.
 *
 * Teardown matched `username LIKE 'e2e-%'` at first, which is a global pattern — and
 * Playwright runs the desktop and phone projects concurrently, so each project's
 * `afterAll` deleted the other's fixtures mid-run. Three tests failed for a reason that
 * had nothing to do with the app, the same way the sweeper's specs raced each other
 * through a global job.
 */
const mine: string[] = [];

/** A paste owned by a throwaway user, inserted directly. */
async function seed(options: {
  body?: string;
  expiresInMinutes?: number | null;
  state?: string;
}): Promise<Seeded> {
  const body = options.body ?? "hello from the fixture\n";
  const id = newPasteId();
  const owner = `e2e-${id.toLowerCase()}`;

  const expiresAt =
    options.expiresInMinutes === null
      ? null
      : new Date(Date.now() + (options.expiresInMinutes ?? 1440) * 60_000);

  return withDb(async (c) => {
    const user = await c.query<{ id: string }>(
      `INSERT INTO paste.users (id, username, display_name)
       VALUES (gen_random_uuid(), $1, 'E2E') RETURNING id`,
      [owner],
    );
    const ownerId = user.rows[0].id;

    await c.query(
      `INSERT INTO paste.pastes
         (id, owner_id, language, language_source, retention_code, never_reason,
          expires_at, purge_after, state, created_via, created_at, updated_at)
       VALUES ($1, $2, 'python', 'explicit', $3, $4, $5, $6, $7, 'web', now(), now())`,
      [
        id,
        ownerId,
        expiresAt === null ? "never" : "1d",
        expiresAt === null ? "an e2e fixture" : null,
        expiresAt,
        expiresAt === null
          ? null
          : new Date(expiresAt.getTime() + 30 * 24 * 60 * 60_000),
        options.state ?? "live",
      ],
    );

    await c.query(
      `INSERT INTO paste.paste_revisions
         (id, paste_id, revision_no, byte_size, line_count, sha256, body_text,
          reason, scan_state, created_by)
       VALUES (gen_random_uuid(), $1, 1, $2, $3, repeat('a', 64), $4,
               'original', 'complete', $5)`,
      [
        id,
        new TextEncoder().encode(body).length,
        body.replace(/\n$/, "").split("\n").length,
        body,
        ownerId,
      ],
    );

    mine.push(owner);
    return { id, body, owner };
  });
}

/** Remove every user this file created, and everything they own. */
test.afterAll(async () => {
  await withDb(async (c) => {
    if (mine.length === 0) return;

    const users = await c.query<{ id: string }>(
      `SELECT id FROM paste.users WHERE username = ANY($1::text[])`,
      [mine],
    );
    for (const { id } of users.rows) {
      // Audit rows are found by subject as well as by actor: the sweeper writes
      // `paste.purged` with a null actor, so deleting by actor alone leaves them behind.
      const pastes = await c.query<{ id: string }>(
        `SELECT id FROM paste.pastes WHERE owner_id = $1`,
        [id],
      );
      for (const p of pastes.rows) {
        await c.query(`DELETE FROM paste.audit_log WHERE subject_id = $1`, [
          p.id,
        ]);
      }
      await c.query(`DELETE FROM paste.audit_log WHERE actor_id = $1`, [id]);
      await c.query(`DELETE FROM paste.pastes WHERE owner_id = $1`, [id]);
      await c.query(`DELETE FROM paste.users WHERE id = $1`, [id]);
    }
  });
});

test.describe("signed out", () => {
  test("the create form renders and offers sign-in", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Not a redirect. `/` is where someone arrives from a link, and bouncing them to a
    // sign-in wall before they have typed anything is the opposite of the product.
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("a live paste reads, with its content", async ({ page }) => {
    const { id, body } = await seed({
      body: "def greet(name):\n    return name\n",
    });
    expect(id).toMatch(BASE58);

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/p/${id}`);

    // The body, not just a 200. A shell that renders with the content missing is the
    // failure PPR introduces, and it has happened here: a resolved Suspense boundary left
    // in a `display: none` div by a CSP that blocked React's relocation script.
    await expect(page.getByText("def greet")).toBeVisible();
    expect(body).toContain("def greet");
  });

  test("the raw and download endpoints serve bytes", async ({ request }) => {
    const { id, body } = await seed({ body: "line one\nline two\n" });

    const raw = await request.get(`/raw/${id}`);
    expect(raw.status()).toBe(200);
    expect(raw.headers()["content-type"]).toContain("text/plain");
    // Byte-for-byte, because this is what a CLI pipes into a file.
    expect(await raw.text()).toBe(body);

    const download = await request.get(`/dl/${id}`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
  });

  test("anyone's list page reads", async ({ page }) => {
    const { owner } = await seed({});

    // Anyone's list, not just one's own. The username comes from the URL because the page
    // is public, which is also what makes cross-tenant scoping easy to get wrong with a
    // single account — `ownership.spec.ts` covers that half.
    const response = await page.goto(`/list/${owner}`);
    expect(response?.status()).toBe(200);
  });

  test("an id that never existed is 404, not a tombstone", async ({ page }) => {
    // A 410 here would let anyone mint a plausible receipt for a paste that never was, by
    // inventing an id and screenshotting the result. `zzzzzzzz` is well-formed base58, so
    // this cannot pass by being rejected on shape.
    const response = await page.goto("/p/zzzzzzzz");
    expect(response?.status()).toBe(404);
  });

  test("a lapsed paste is 410 and keeps its URL", async ({ page }) => {
    const { id } = await seed({ expiresInMinutes: -60 });

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(410);
    // The permalink is the product: the URL must not change for any of these answers.
    expect(new URL(page.url()).pathname).toBe(`/p/${id}`);
    // And the receipt, not a bare error page — that is the composition detail a unit test
    // of the status decision cannot see.
    await expect(page.getByText(/410 Gone/)).toBeVisible();
  });

  test("the view page loads no third-party script", async ({ page }) => {
    const { id } = await seed({});

    const remote: { origin: string; type: string }[] = [];
    const local = (u: string) =>
      u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost");

    page.on("request", (r) => {
      if (local(r.url())) return;
      remote.push({ origin: new URL(r.url()).origin, type: r.resourceType() });
    });

    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");

    // SCRIPTS AND SUBRESOURCES, not navigations — and the distinction is measured rather
    // than assumed.
    //
    // `ClerkProvider` in the root layout loaded `clerk.browser.js` here, a genuine
    // third-party script on the page that renders hostile text (§6.5). That is what this
    // asserts, and the module-graph test cannot: a page does not import its layout.
    //
    // What remains is one request of type `document` to the Clerk instance origin, with
    // `x-clerk-auth-reason: dev-browser-missing` on the response. That is Clerk's
    // DEVELOPMENT-INSTANCE handshake: a development instance lives on a different domain
    // from the app, so it cannot set a first-party cookie and bounces the browser through
    // its own domain once to do it. A production instance on the app's own domain does not.
    // Asserting zero remote requests would therefore fail only in development and pass in
    // production, which is the wrong way round for a security test — it has to be
    // re-verified against a production instance at M13 rather than encoded here.
    const subresources = remote.filter((r) => r.type !== "document");
    expect(subresources).toEqual([]);
    expect(
      remote.filter((r) => r.type === "script"),
      "a third-party script on the view page",
    ).toEqual([]);
  });

  test("writing is refused", async ({ request }) => {
    // The other half of the premise. Reads are open; this must not be.
    const response = await request.post("/api/pastes?retention=1d", {
      headers: { "Content-Type": "text/plain", Accept: "text/plain" },
      data: "should not be stored\n",
    });

    expect(response.status()).toBe(401);
  });
});
