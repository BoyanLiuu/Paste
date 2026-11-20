import { createHash } from "node:crypto";

// The caller's address, as a key a rate bucket can hold (ARCHITECTURE §4 stage 2, M14).
//
// WHY THIS EXISTS AT ALL. Until M14 every limit was keyed on a user id, which is the right
// key for an account and no key at all for anything else: a signed-out caller has no row to
// charge, and `pastes.created_ip_hash` had been plumbed end to end since M6 with no caller
// ever filling it. So there was no way to throttle abuse and no way to investigate it after
// the fact. This module is the key both of those need.
//
// NEVER THE ADDRESS ITSELF, anywhere. An IP is personal data and a table of them is a
// liability with no upside: every consumer here wants "is this the same source", which a
// hash answers. `created_ip_hash`'s own column comment has said so since M6.
//
// TWO HASHES, FOR TWO JOBS, which is the part worth reading before changing anything:
//
//   - `rateKey` uses a STABLE salt, because a bucket whose key changes is a bucket that
//     resets. A daily-rotating key would empty the minute bucket at midnight UTC — a hole
//     that opens once a day and closes by itself before anyone looks at it.
//   - `investigationHash` uses a salt that ROTATES DAILY, which is what `created_ip_hash`
//     stores. It answers "which pastes came from one source today" and deliberately stops
//     answering across days, so the column cannot become a permanent per-person history.
//
// An earlier draft of ARCHITECTURE Appendix B claimed one rotating salt forced two buckets.
// It does not: the two hashes have different purposes, and only one of them needs stability.

/** A /64 holds one customer's whole network, so it is the unit for v6. */
const IPV6_PREFIX_GROUPS = 4;

/**
 * The client's address, from the proxy header.
 *
 * THE FIRST ENTRY, AND ONLY THE FIRST. `x-forwarded-for` is a list that each hop appends
 * to, so the leftmost value is the original client and every later one is infrastructure.
 * Reading the last would key the bucket on our own edge and throttle every caller as one.
 *
 * TRUSTWORTHY ON VERCEL, where the edge overwrites this header rather than appending to it,
 * so a client cannot choose its own value. **On any other deployment it is not**: behind an
 * unknown number of proxies the leftmost entry is attacker-controlled, and keying a limit on
 * it hands the attacker the choice of which bucket to drain. A self-hosted origin has to
 * count its proxies and index from the right instead.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }

  // Vercel sets this and it is a single value, so it needs no splitting. Checked second
  // because `x-forwarded-for` is the one every other host sets.
  const real = headers.get("x-real-ip")?.trim();
  return real !== undefined && real !== "" ? real : null;
}

/**
 * The portion of an address a limit should apply to.
 *
 * IPv6 COLLAPSES TO ITS /64, and this is the difference between a throttle and a
 * decoration. A residential or cloud customer is routinely handed an entire /64 — 2^64
 * addresses — so keying on the full address lets one actor rotate through more addresses
 * than there are grains of sand, for free, without leaving their own network. /64 is the
 * smallest block anyone is assigned, so it is the smallest honest unit.
 *
 * IPv4 keys on the whole address. Narrowing to a /24 would group unrelated customers.
 */
export function limitScope(ip: string): string {
  // A zone index (`fe80::1%eth0`) and a bracketed-with-port form both appear in the wild.
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0];

  if (!bare.includes(":")) return bare;

  // AN IPv4-MAPPED ADDRESS IS AN IPv4 ADDRESS, and missing this was the worst bug in this
  // module. `::ffff:203.0.113.7` is how a dual-stack socket reports an IPv4 client — which
  // is what Node does by default, and what several proxies emit — and its first four groups
  // are all zero. So every IPv4 client on earth collapsed to the single key
  // `0:0:0:0::/64`, together with loopback: one shared 20-request-per-minute bucket for the
  // entire internet. The throttle would have become a denial of service against every user,
  // and it is the exact failure the first test in this module's spec was written to prevent,
  // reached by a route that test did not cover.
  const mapped = ipv4Mapped(bare);
  if (mapped !== null) return mapped;

  // `::` may stand for any number of zero groups, so the prefix is taken from the left
  // after expansion rather than by slicing the text — `2001:db8::1` has four leading
  // groups of which only two are written.
  const groups = expandIpv6(bare);
  if (groups === null) return bare;

  // NORMALISED, NOT JUST SPLIT. A group may be written with leading zeros, so `2001:0db8:…`
  // and `2001:db8:…` are the SAME address — and until this line they produced two different
  // keys, which is a bucket reset available to anyone who pads their own address. Caught by
  // `client-ip.spec.ts` on its first run.
  const prefix = groups
    .slice(0, IPV6_PREFIX_GROUPS)
    .map((group) => group.replace(/^0+(?=.)/, "").toLowerCase());

  return prefix.join(":") + "::/64";
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 one, or null if there is not one.
 *
 * Both spellings occur. `::ffff:203.0.113.7` keeps the dotted quad, which is what a socket
 * and most proxies produce; `::ffff:cb00:7107` writes the same four bytes as two hex groups,
 * which `inet_ntop` can emit. Treating only the first would leave the second collapsing to
 * the shared key this function exists to avoid.
 */
function ipv4Mapped(address: string): string | null {
  const groups = expandIpv6(address);
  if (groups === null) return null;

  const normalised = groups.map((g) => g.replace(/^0+(?=.)/, "").toLowerCase());

  // FIVE ZERO GROUPS THEN `ffff`, AND ONLY THAT. An earlier version also accepted six zero
  // groups — the deprecated IPv4-COMPATIBLE form `::203.0.113.7` — and that made `::1` read
  // as the IPv4 address `0.0.0.1`, because the loopback is indistinguishable from a
  // compatible-form address under that rule. The compatible form is effectively extinct and
  // nothing emits it, while `::ffff:` is what a dual-stack socket produces every time. So
  // the narrow rule is both correct and sufficient: a compatible-form address now falls
  // through to the /64 path, where it keys with the other addresses nobody sends.
  const zeros = normalised.slice(0, 5).every((g) => g === "0");
  if (!zeros || normalised[5] !== "ffff") return null;

  const tail = normalised.slice(6);

  // Dotted form: the quad survived `split(":")` as one segment.
  const dotted = tail.find((g) => g.includes("."));
  if (dotted !== undefined) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(dotted) ? dotted : null;
  }

  // Hex form: two groups, high bytes first.
  if (tail.length !== 2) return null;
  const [high, low] = tail.map((g) => Number.parseInt(g, 16));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * The eight groups of an IPv6 address, or null if it does not parse as one.
 *
 * A TRAILING DOTTED QUAD IS CONVERTED FIRST, and that is not cosmetic. Four bytes of IPv4
 * occupy TWO groups of an IPv6 address, but `split(":")` counts `203.0.113.7` as ONE
 * segment — so the `::` zero-fill came out one group too long, and `::ffff:203.0.113.7`
 * expanded with six leading zeros instead of five. That put `ffff` in the wrong position and
 * made the mapped-address check miss the single most common spelling of the thing it exists
 * to catch, while the rarer hex spelling worked. Converting to hex up front means every
 * caller below counts groups the same way.
 */
function expandIpv6(address: string): string[] | null {
  const quad = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (quad !== null) {
    const bytes = quad.slice(1, 5).map(Number);
    if (bytes.some((b) => b > 255)) return null;
    const high = ((bytes[0] << 8) | bytes[1]).toString(16);
    const low = ((bytes[2] << 8) | bytes[3]).toString(16);
    address = `${address.slice(0, quad.index)}:${high}:${low}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail =
    halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];

  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;

  return [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
}

/**
 * The rate bucket's key for this request, or null when there is no address to key on.
 *
 * NULL IS A REAL ANSWER, and the caller has to decide what it means. Locally there is no
 * proxy and therefore no header, so every development request would otherwise share one
 * bucket and the twentieth `pnpm dev` save of the day would start refusing. The create path
 * treats a null key as "no IP limit applies" because the session limit still does; an
 * anonymous create path (M15) must treat it as a refusal instead, since it would otherwise
 * be the whole limit going missing.
 */
export function rateKey(headers: Headers): string | null {
  const ip = clientIp(headers);
  if (ip === null) return null;

  // NO `ip:` PREFIX. An earlier draft returned one, for a single keyspace shared with
  // account buckets — and then the design went to two tables, which made the prefix
  // vestigial: `ip_buckets` holds nothing else. It survived long enough to put 67-character
  // values in a column documented as 64 hex characters, which is the kind of small
  // disagreement that makes a later reader distrust the comment rather than the data.
  return hash(limitScope(ip), stableSalt());
}

/**
 * The value `pastes.created_ip_hash` stores.
 *
 * SALTED PER DAY, so the column groups a day's pastes by source and stops there. The point
 * of the rotation is that the stored value is useless for building a history: a hash from
 * last month cannot be matched to one from today even by us.
 *
 * The full address, not the /64 — this one is for identifying a source after the fact, where
 * the extra precision is the whole value, rather than for deciding a limit.
 */
export function investigationHash(headers: Headers): string | null {
  const ip = clientIp(headers);
  return ip === null ? null : hash(ip, dailySalt());
}

function hash(value: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

/**
 * The secret both salts are built from.
 *
 * AN UNSALTED HASH OF AN IP IS NOT ANONYMOUS. The entire IPv4 space is 4.3 billion values,
 * which a laptop enumerates against SHA-256 in minutes — so `sha256(ip)` is a reversible
 * encoding of the address, not a pseudonym. The salt is what makes it one, and it therefore
 * has to be secret and stable.
 *
 * ABSENT IN DEVELOPMENT, deliberately: a fixed fallback keeps `pnpm dev` and the test suite
 * working without anyone configuring anything. It is not a secret in that case and does not
 * need to be, because the addresses it protects are `127.0.0.1`. Production supplies
 * `RATE_SALT`, and `environment.spec.ts` is where a missing one should fail the deploy.
 */
function secret(): string {
  return process.env.RATE_SALT ?? "paste-development-salt";
}

function stableSalt(): string {
  return `rate:${secret()}`;
}

/** `YYYY-MM-DD` in UTC, matching the rate limiter's own day boundary. */
function dailySalt(): string {
  return `ip:${secret()}:${new Date().toISOString().slice(0, 10)}`;
}
