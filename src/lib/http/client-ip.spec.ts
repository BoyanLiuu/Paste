// @vitest-environment node

// The rate limit's key (ARCHITECTURE §4 stage 2, M14).
//
// Every case here is a way the limit silently stops limiting. None of them throws, none
// shows up in a log, and all of them look like a working throttle from the outside — which
// is why this file asserts the key rather than the refusal.

import { describe, expect, it } from "vitest";

import {
  clientIp,
  investigationHash,
  limitScope,
  rateKey,
} from "@/lib/http/client-ip";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("clientIp", () => {
  it("takes the FIRST x-forwarded-for entry, not the last", () => {
    // THE BUG THIS CATCHES: reading the last entry keys every request on our own edge, so
    // the whole world shares one bucket and the first twenty callers exhaust it for
    // everybody. Reading the first is also what makes a client unable to pick its bucket
    // on Vercel, where the edge overwrites rather than appends.
    expect(
      clientIp(
        headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 10.0.0.1" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("ignores a client-supplied second entry", () => {
    // A caller appending their own value cannot move the key: the leftmost is the one the
    // edge wrote. Asserted separately from the above because this is the attack, and the
    // test above is the misconfiguration.
    expect(
      clientIp(headers({ "x-forwarded-for": "203.0.113.7, 203.0.113.99" })),
    ).toBe("203.0.113.7");
  });

  it("trims whitespace, which proxies add inconsistently", () => {
    expect(clientIp(headers({ "x-forwarded-for": "  203.0.113.7  " }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip, and prefers x-forwarded-for when both are present", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    expect(
      clientIp(
        headers({
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "203.0.113.7",
        }),
      ),
    ).toBe("198.51.100.1");
  });

  it("returns null when there is no address, rather than a placeholder", () => {
    // An empty header is reachable: a misconfigured proxy sends the name with no value,
    // and `"".split(",")[0]` is `""`. Keying a bucket on the empty string would put every
    // such request in one bucket — the first failure above by another route.
    expect(clientIp(headers({}))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(headers({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("limitScope", () => {
  it("keys IPv4 on the whole address", () => {
    expect(limitScope("203.0.113.7")).toBe("203.0.113.7");
  });

  it("collapses IPv6 to its /64", () => {
    // THE DEFECT THIS EXISTS FOR. A customer is handed an entire /64 — 2^64 addresses — so
    // keying on the full address lets one actor rotate forever inside their own allocation
    // without the bucket ever seeing the same key twice. Two addresses in one /64 must
    // produce one key.
    const a = limitScope("2001:db8:85a3:1234:0000:8a2e:0370:7334");
    const b = limitScope("2001:db8:85a3:1234:ffff:ffff:ffff:0001");

    expect(a).toBe(b);
    expect(a).toBe("2001:db8:85a3:1234::/64");
  });

  it("does not merge two different /64s", () => {
    // The other half: over-collapsing would group unrelated customers and throttle
    // strangers for each other's traffic.
    expect(limitScope("2001:db8:85a3:1234::1")).not.toBe(
      limitScope("2001:db8:85a3:5678::1"),
    );
  });

  it("expands `::` before taking the prefix, rather than slicing the text", () => {
    // `2001:db8::1` writes two leading groups and HAS four, so a text slice would key it
    // as `2001:db8:1` — a different /64 from the same address written out in full, which
    // makes one source look like two.
    expect(limitScope("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(limitScope("2001:db8:0:0:0:0:0:1")).toBe("2001:db8:0:0::/64");
    expect(limitScope("2001:db8::1")).toBe(limitScope("2001:0db8:0:0::99"));
  });

  it("handles a loopback, a zone index and brackets", () => {
    // All three appear in real headers; none should fall through as an unparsed string
    // that then keys its own bucket.
    expect(limitScope("::1")).toBe("0:0:0:0::/64");
    expect(limitScope("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(limitScope("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
  });

  it("treats an IPv4-MAPPED address as the IPv4 address it is", () => {
    // THE WORST BUG IN THIS MODULE, and it took three attempts to fix. `::ffff:203.0.113.7`
    // is how a dual-stack socket reports an IPv4 client — which is Node's default, and what
    // several proxies emit. Its first four groups are zero, so every IPv4 client on earth
    // collapsed to the single key `0:0:0:0::/64`: one shared 20-per-minute bucket for the
    // entire internet, turning the throttle into a denial of service against every user.
    //
    // It is the same failure the first test in this file guards — "the whole world shares
    // one bucket" — reached by a route that test could not see.
    expect(limitScope("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(limitScope("::ffff:198.51.100.9")).toBe("198.51.100.9");

    // And they must not share a key with each other, which is the actual harm.
    expect(limitScope("::ffff:203.0.113.7")).not.toBe(
      limitScope("::ffff:198.51.100.9"),
    );

    // The mapped form and the bare form are one address and must key as one.
    expect(limitScope("::ffff:203.0.113.7")).toBe(limitScope("203.0.113.7"));
  });

  it("reads every spelling of a mapped address the same way", () => {
    // `inet_ntop` can write the four bytes as two hex groups, and a proxy may expand the
    // zero run. Fixing only the dotted spelling left the hex one collapsing to the shared
    // key — so all three are asserted together.
    const want = "203.0.113.7";
    expect(limitScope("::ffff:203.0.113.7")).toBe(want);
    expect(limitScope("::ffff:cb00:7107")).toBe(want);
    expect(limitScope("0:0:0:0:0:ffff:203.0.113.7")).toBe(want);
  });

  it("does not mistake the IPv6 loopback for an IPv4 address", () => {
    // An intermediate fix accepted the deprecated IPv4-COMPATIBLE form (`::203.0.113.7`,
    // six zero groups) and consequently read `::1` as the IPv4 address `0.0.0.1`. The
    // compatible form is extinct; `::ffff:` is the one that occurs. Narrowing to it is what
    // makes this correct.
    expect(limitScope("::1")).toBe("0:0:0:0::/64");
    expect(limitScope("::")).toBe("0:0:0:0::/64");
  });

  it("returns something rather than throwing on an unparseable value", () => {
    // The header is attacker-supplied in the general case. A throw here would 500 the
    // create path, which is a worse outcome than keying a junk value to its own bucket.
    expect(limitScope("not:an:address:at:all:x:y:z:q")).toBe(
      "not:an:address:at:all:x:y:z:q",
    );
  });
});

describe("rateKey", () => {
  it("never contains the address", () => {
    // The whole reason this is a hash. A key that embeds the address puts personal data in
    // a primary key, in query logs, and in every error that quotes one.
    const key = rateKey(headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(key).not.toBeNull();
    expect(key).not.toContain("203.0.113.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls, so the bucket does not reset under it", () => {
    // THE MIDNIGHT HOLE. If this key rotated — as `created_ip_hash`'s salt deliberately
    // does — the bucket it addresses would be abandoned and a fresh, full one created in
    // its place. That is a limit that lifts itself on a schedule.
    const first = rateKey(headers({ "x-forwarded-for": "203.0.113.7" }));
    const second = rateKey(headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(first).toBe(second);
  });

  it("gives two addresses in one IPv6 /64 the same key", () => {
    expect(
      rateKey(headers({ "x-forwarded-for": "2001:db8:1:2:3:4:5:6" })),
    ).toBe(rateKey(headers({ "x-forwarded-for": "2001:db8:1:2:ffff::9" })));
  });

  it("gives different addresses different keys", () => {
    expect(rateKey(headers({ "x-forwarded-for": "203.0.113.7" }))).not.toBe(
      rateKey(headers({ "x-forwarded-for": "203.0.113.8" })),
    );
  });

  it("is null with no address, so the caller decides what that means", () => {
    expect(rateKey(headers({}))).toBeNull();
  });
});

describe("investigationHash", () => {
  it("never contains the address", () => {
    const h = investigationHash(headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(h).not.toContain("203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs from the rate key for the same address", () => {
    // Two salts, two purposes. If they were the same value, the column stored on every
    // paste would be a lookup table for the rate-limit keys — so reading the database
    // would tell you which bucket to drain.
    const ip = headers({ "x-forwarded-for": "203.0.113.7" });
    expect(investigationHash(ip)).not.toBe(rateKey(ip));
  });

  it("keys the full address rather than the /64", () => {
    // The opposite choice from `limitScope`, on purpose: this one identifies a source
    // after the fact, where precision is the point.
    expect(
      investigationHash(headers({ "x-forwarded-for": "2001:db8:1:2:3:4:5:6" })),
    ).not.toBe(
      investigationHash(headers({ "x-forwarded-for": "2001:db8:1:2:ffff::9" })),
    );
  });
});
