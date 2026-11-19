// @vitest-environment node

// A capability enforced in the UI but not in the action (ARCHITECTURE §2, §3).
//
// The premise is read-public, write-authenticated. The way that premise fails is not a
// visible button — it is a hidden one, with the action behind it still callable. A Server
// Action is an HTTP endpoint whose name ships to the browser; hiding the form that calls
// it changes nothing about who can invoke it.
//
// So every mutation is called directly, as a visitor, and must refuse — and must refuse
// BEFORE writing anything, which is the part a 403 returned after the insert would not
// give you.

import { describe, expect, it } from "vitest";

import { can, deniedTo, roleOf } from "@/lib/server/capabilities";
import {
  ownedCounts,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import {
  createPaste,
  decideRequest,
  forkPaste,
  requestRemoval,
} from "@/lib/server/mutations";
import { NotPermittedError } from "@/lib/server/viewer";
import type { Capability, Viewer } from "@/lib/types";

const VISITOR: Viewer = { kind: "anon" };

const member = (username: string): Viewer => ({
  kind: "user",
  user: { username, displayName: username, isModerator: false },
});

const moderator = (username: string): Viewer => ({
  kind: "user",
  user: { username, displayName: username, isModerator: true },
});

/** Every capability the type declares, so a new one cannot be added untested. */
const ALL: Capability[] = [
  "paste:create",
  "paste:fork",
  "removal:request",
  "removal:decide",
  "retention:extended",
];

describe("the capability table", () => {
  it("derives three roles, because the design has three actors", () => {
    // `Viewer["kind"]` is two-valued and cannot tell a member from a moderator. M1's
    // placeholder table was keyed on it, so a moderator-only action keyed that way would
    // have been gated by "is signed in".
    expect(roleOf(VISITOR)).toBe("visitor");
    expect(roleOf(member("a"))).toBe("member");
    expect(roleOf(moderator("b"))).toBe("moderator");
  });

  it("denies a visitor every write and allows every read", () => {
    // Reads take no capability at all, which is the premise stated as an absence: there is
    // nothing in this table to grant a visitor, because reading is not gated.
    for (const capability of [
      "paste:create",
      "paste:fork",
      "removal:request",
      "removal:decide",
    ] as Capability[]) {
      expect(can(VISITOR, capability), capability).toBe(false);
    }
  });

  it("lets a member write but not decide", () => {
    expect(can(member("a"), "paste:create")).toBe(true);
    expect(can(member("a"), "paste:fork")).toBe(true);
    expect(can(member("a"), "removal:request")).toBe(true);
    // Asking is not deciding. The relationship check in `mayRequestRemoval` is separate
    // and narrower — this says "signed in is enough to ask".
    expect(can(member("a"), "removal:decide")).toBe(false);
  });

  it("denies a moderator nothing", () => {
    for (const capability of ALL) {
      expect(can(moderator("b"), capability), capability).toBe(true);
    }
    expect(deniedTo("moderator")).toEqual([]);
  });

  it("gates extended retention on a written reason, not on a role", () => {
    // §6.3: the `never` option is kept rare by making someone explain it. Gating it on
    // permission would turn the unbounded choice into a privilege, and a privilege is
    // granted once and then never thought about again.
    for (const viewer of [VISITOR, member("a"), moderator("b")]) {
      expect(can(viewer, "retention:extended")).toBe(true);
    }
  });

  it("covers every capability the type declares", () => {
    // Guards the guard: a capability added to the union and forgotten here would be
    // untested, and a denial list fails open.
    const mentioned = new Set([
      ...deniedTo("visitor"),
      ...deniedTo("member"),
      ...deniedTo("moderator"),
      "retention:extended" as Capability,
    ]);
    for (const capability of ALL) {
      expect(mentioned.has(capability), `${capability} is untested`).toBe(true);
    }
  });
});

const reason = skipReason();

describe.skipIf(reason !== null)(
  `mutations as a visitor${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("refuses createPaste without writing a row", async () => {
      await withTestOwner(async (owner) => {
        await expect(
          createPaste(VISITOR, { body: "x\n", retention: "1h" }),
        ).rejects.toThrow(NotPermittedError);

        // Nothing written, and the refusal came before the scanner and the insert — not
        // after them with a rollback. A 403 issued after the work is still a 403, but it
        // means an unauthenticated caller can make the server scan arbitrary text.
        expect((await ownedCounts(owner.userId)).pastes).toBe(0);
      });
    });

    it("refuses every other mutation too", async () => {
      // All four, so a new mutation that forgets `assertCan` is visible here rather than
      // in a security review. Each must throw NotPermittedError specifically — a
      // not-implemented error would mean the permission check never ran.
      await expect(forkPaste(VISITOR, "7fK2mQxZ", "1h")).rejects.toThrow(
        NotPermittedError,
      );
      await expect(
        requestRemoval(VISITOR, "7fK2mQxZ", {
          relationship: "owner",
          reason: "secret",
          justification: "mine",
        }),
      ).rejects.toThrow(NotPermittedError);
      await expect(
        decideRequest(VISITOR, 1, { action: "deny", note: "no" }),
      ).rejects.toThrow(NotPermittedError);
    });

    it("refuses decideRequest to a member, not just to a visitor", async () => {
      // The denial that is easy to miss, because a member passes "is signed in" — which
      // is what a two-valued table would have checked.
      await expect(
        decideRequest(member("someone"), 1, { action: "deny", note: "no" }),
      ).rejects.toThrow(NotPermittedError);
    });

    it("names the capability in the error, so a 403 is diagnosable", async () => {
      const error = await createPaste(VISITOR, {
        body: "x\n",
        retention: "1h",
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotPermittedError);
      expect((error as NotPermittedError).capability).toBe("paste:create");
    });
  },
);
