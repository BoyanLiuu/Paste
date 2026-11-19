// @vitest-environment node

// A storage failure must fail the request, not render an empty paste.
//
// This is the bug this file exists for, found in review: `getBody` returned null on any
// failure — a 404, an expired key, a network timeout, a misconfigured bucket — and the
// read path treated null as "no body". The view then rendered an empty `<pre>` and told
// the reader, with a 200, that the snippet was empty.
//
// A transient outage producing a WRONG ANSWER is worse than one producing an error,
// because nobody retries an answer. And there is no legitimate missing-object case to be
// forgiving about: the purge NULLs `storage_key` in the same statement that deletes the
// object, and the create path uploads before inserting, so a revision that still holds a
// key is one whose object must exist.
//
// Needs no storage credentials, which is why it is here rather than in `large-body.spec`.

import { describe, expect, it, vi } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };
const reason = skipReason();

/** Replace the storage module for one test. */
async function withStorage<T>(
  overrides: Record<string, unknown>,
  body: (service: typeof import("@/lib/server/paste-service")) => Promise<T>,
): Promise<T> {
  vi.resetModules();
  vi.doMock("@/lib/storage/body", async () => {
    const real =
      await vi.importActual<typeof import("@/lib/storage/body")>(
        "@/lib/storage/body",
      );
    return { ...real, storageConfigured: () => true, ...overrides };
  });

  try {
    return await body(await import("@/lib/server/paste-service"));
  } finally {
    vi.doUnmock("@/lib/storage/body");
    vi.resetModules();
  }
}

describe.skipIf(reason !== null)(
  `the object read path${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("propagates a storage failure instead of serving an empty body", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { storageKey: "revisions/unreachable" },
        ]);

        await withStorage(
          {
            getBody: async () => {
              throw new Error("bucket unreachable");
            },
          },
          async (service) => {
            // The request fails. Next turns this into a 500, which is a reader seeing an
            // error and a retry working — rather than a reader seeing nothing and
            // believing it.
            await expect(service.getPaste(VIEWER, id)).rejects.toThrow(
              /unreachable/,
            );
          },
        );
      });
    });

    it("propagates it on the raw path too", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { storageKey: "revisions/unreachable" },
        ]);

        await withStorage(
          {
            getBody: async () => {
              throw new Error("bucket unreachable");
            },
          },
          async (service) => {
            // /raw serving an empty file is worse than /raw returning an error: the empty
            // file gets piped into something and saved.
            await expect(service.getRaw(VIEWER, id)).rejects.toThrow(
              /unreachable/,
            );
          },
        );
      });
    });

    it("serves the stored body when storage answers", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { storageKey: "revisions/fine" },
        ]);

        await withStorage(
          { getBody: async () => "line one\nline two\n" },
          async (service) => {
            // Guards the guard: a read path that always threw would pass both assertions
            // above while serving nothing at all.
            const paste = await service.getPaste(VIEWER, id);
            expect(paste!.body).toBe("line one\nline two\n");
            expect(paste!.storage).toBe("object");
            await expect(service.getRaw(VIEWER, id)).resolves.toBe(
              "line one\nline two\n",
            );
          },
        );
      });
    });

    it("leaves an inline body alone, without asking storage anything", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "inline\n" }]);

        await withStorage(
          {
            getBody: async () => {
              throw new Error("storage must not be consulted");
            },
          },
          async (service) => {
            // A paste under the threshold must not touch the bucket at all. Calling
            // storage for every read would put a network round trip on the hot path for
            // the overwhelming majority of pastes, which are small.
            const paste = await service.getPaste(VIEWER, id);
            expect(paste!.body).toBe("inline\n");
            expect(paste!.storage).toBe("postgres");
          },
        );
      });
    });
  },
);
