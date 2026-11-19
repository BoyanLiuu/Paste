// @vitest-environment node

// The shell contract (ARCHITECTURE §3, §4 stage 9).
//
// `url=$(curl -s --data-binary @file -H 'Accept: text/plain' …/api/pastes)` has to put a
// usable URL in `$url`. One stray character breaks that, and the breakage looks like the
// server being wrong rather than the response being chatty: a trailing blank line, a
// "Created:" prefix, or JSON when text was asked for all survive a browser test and all
// make the pipeline produce garbage.
//
// So this asserts the response is exactly one newline-terminated line and nothing else.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { skipReason, slackTokenShape } from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const reason = skipReason();

const ORIGIN = "http://localhost:3025";

// A user of this file's own, rather than the fixture viewer.
//
// The rate limit is charged on attempts (§4 stage 2), so running as `deepika` spends her
// bucket: ~8 attempts per run against a 20-token minute ceiling, which means two
// consecutive suite runs start getting 429s and the failure looks like a broken route.
// A fresh user per run has a full bucket and is isolated from every other test file.
const USERNAME = `t-route-${randomUUID().slice(0, 8)}`;
let userId: string;

vi.mock("@/lib/server/session", async () => {
  const real = await vi.importActual<typeof import("@/lib/server/viewer")>(
    "@/lib/server/viewer",
  );
  return {
    ...real,
    getViewer: async (): Promise<Viewer> => ({
      kind: "user",
      user: { username: USERNAME, displayName: "Route", isModerator: false },
    }),
  };
});

const { POST } = await import("@/app/api/pastes/route");

function raw(body: string, accept = "text/plain", query = ""): Request {
  return new Request(`${ORIGIN}/api/pastes${query}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Accept: accept },
    body,
  });
}

function json(payload: unknown, accept = "application/json"): Request {
  return new Request(`${ORIGIN}/api/pastes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify(payload),
  });
}

/** Remove whatever a test created, by id. Scoped to one id, never a bare delete. */
async function removePaste(id: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { subjectId: id } });
  await prisma.paste.deleteMany({ where: { id } });
}

describe.skipIf(reason !== null)(
  `plain text responses${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    beforeAll(async () => {
      const row = await prisma.user.upsert({
        where: { username: USERNAME },
        create: { username: USERNAME, displayName: "Route" },
        update: {},
        select: { id: true },
      });
      userId = row.id;
    });

    afterAll(async () => {
      // Scoped to the id this file generated. Pastes first, because
      // `paste_revisions.created_by` restricts — authorship is not something a user
      // deletion should silently erase, so the owning paste takes its revisions with it.
      await prisma.auditLog.deleteMany({ where: { actorId: userId } });
      await prisma.paste.deleteMany({ where: { ownerId: userId } });
      await prisma.user.delete({ where: { id: userId } });
    });

    it("returns exactly one newline-terminated URL and nothing else", async () => {
      const response = await POST(raw("hello from the shell\n"));
      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toMatch(/^text\/plain/);

      const text = await response.text();

      // One trailing newline, and no other newline anywhere. `split` rather than a
      // regex so the failure message shows what actually came back.
      expect(text.endsWith("\n")).toBe(true);
      expect(text.split("\n")).toHaveLength(2);
      expect(text.split("\n")[1]).toBe("");

      const url = text.trim();
      expect(url).toBe(`${ORIGIN}/p/${url.split("/p/")[1]}`);
      // An absolute URL, because `$url` gets pasted into a browser or a message. A bare
      // id or a relative path would need the caller to know the origin.
      expect(url.startsWith("http://")).toBe(true);

      const id = url.split("/p/")[1];
      expect(id).toHaveLength(8);
      await removePaste(id);
    });

    it("sets Location to the same paste it printed", async () => {
      const response = await POST(raw("text\n"));
      const id = (await response.text()).trim().split("/p/")[1];
      // A client that follows Location and a client that reads the body must land on the
      // same paste. Disagreeing is the kind of bug nobody notices until a redirect.
      expect(response.headers.get("location")).toBe(`/p/${id}`);
      await removePaste(id);
    });

    it("returns JSON when text/plain was not asked for", async () => {
      // `*/*` is curl's default and means "whatever you have". JSON is the better answer
      // for a client that expressed no preference, and treating `*/*` as plain text
      // would make the richer response unreachable from curl without a header.
      const response = await POST(raw("text\n", "*/*"));
      expect(response.headers.get("content-type")).toMatch(/application\/json/);

      const payload = (await response.json()) as { id: string; url: string };
      expect(payload.id).toHaveLength(8);
      expect(payload.url).toContain(`/p/${payload.id}`);
      await removePaste(payload.id);
    });

    it("carries no body-derived text in a refusal a pipeline might capture", async () => {
      // A 422 must not print a URL-shaped line, or `url=$(curl …)` on a blocked paste
      // would assign an error message and the next command would use it as an address.
      const response = await POST(
        raw(`SLACK_TOKEN = "${slackTokenShape()}"\n`),
      );
      expect(response.status).toBe(422);

      const text = await response.text();
      expect(text).not.toContain("/p/");
      // And never the credential itself, in any response.
      expect(text).not.toContain(slackTokenShape());
    });

    it("refuses a body that is not UTF-8 rather than storing replacement characters", async () => {
      // 0xFF is not valid UTF-8 anywhere. Without `fatal: true` the decoder substitutes
      // U+FFFD per bad byte, so a JPEG would be stored as a wall of replacement
      // characters — accepted, unusable, and counted against the user's quota.
      const response = await POST(
        new Request(`${ORIGIN}/api/pastes`, {
          method: "POST",
          headers: { "Content-Type": "text/plain", Accept: "text/plain" },
          body: new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x0a]),
        }),
      );
      expect(response.status).toBe(415);
      expect(await response.text()).toContain("UTF-8");
    });

    it("takes options from the query string on the raw path", async () => {
      // `curl` can express a query string around a file; it cannot easily build JSON
      // around one. Without this, every non-browser caller is stuck on defaults.
      const response = await POST(
        raw(
          "SELECT 1;\n",
          "*/*",
          "?language=sql&lineNumbers=true&retention=1h&title=from-curl",
        ),
      );
      const payload = (await response.json()) as {
        id: string;
        language: string;
        languageSource: string;
      };
      expect(payload.language).toBe("sql");
      // Explicit wins and is never second-guessed, which is rung 1 of the ladder.
      expect(payload.languageSource).toBe("explicit");

      const row = await prisma.paste.findUniqueOrThrow({
        where: { id: payload.id },
      });
      expect(row.lineNumbers).toBe(true);
      expect(row.title).toBe("from-curl");
      // Recorded honestly as a non-browser caller rather than as the form.
      expect(row.createdVia).toBe("api");

      await removePaste(payload.id);
    });

    it("reports field errors on the JSON path in the shape the form reads", async () => {
      const response = await POST(json({ body: "", retention: "1h" }));
      expect(response.status).toBe(422);
      const payload = (await response.json()) as {
        fields: Record<string, string[]>;
      };
      // field -> messages, which is what the form binds to. A flat string list here
      // would make the form unable to put the message next to the input.
      expect(payload.fields.body?.[0]).toContain("Nothing to save");
    });

    it("requires a reason for never, on the API path too", async () => {
      // "never" is the only retention with unbounded cost. The rule lives in the shared
      // schema rather than the component precisely so the API path cannot be talked out
      // of it (§6.3).
      const response = await POST(json({ body: "x\n", retention: "never" }));
      expect(response.status).toBe(422);
      const payload = (await response.json()) as {
        fields: Record<string, string[]>;
      };
      expect(payload.fields.neverReason?.[0]).toContain("why");
    });
  },
);
