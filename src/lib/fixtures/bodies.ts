// Sample bodies, ported from the prototype's hallmark/data.js.
//
// The generators are seeded so a log is byte-identical on every load. That is not
// cosmetic: fixture sha256 values are computed from these bodies, and a generator that
// drifted would change a hash the purged-receipt screen displays.
//
// Every credential-shaped string here is assembled by concatenation so that this file
// does not itself contain a scannable secret.

export const PY = `#!/usr/bin/env python3
"""Retry a flaky HTTP call with capped exponential backoff and full jitter."""
import random
import time
import urllib.error
import urllib.request

BASE_DELAY = 0.5  # seconds
MAX_DELAY = 30.0
MAX_ATTEMPTS = 6


def backoff(attempt: int) -> float:
    """Full jitter: a random wait between 0 and the capped exponential."""
    ceiling = min(MAX_DELAY, BASE_DELAY * 2 ** attempt)
    return random.uniform(0, ceiling)


def fetch(url: str, timeout: float = 5.0) -> bytes:
    last_error = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as err:
            if err.code < 500 and err.code != 429:
                raise  # a 4xx won't get better by waiting
            last_error = err
        except urllib.error.URLError as err:
            last_error = err
        wait = backoff(attempt)
        print(f"attempt {attempt + 1} failed ({last_error}); retrying in {wait:.2f}s")
        time.sleep(wait)
    raise RuntimeError(f"gave up after {MAX_ATTEMPTS} attempts") from last_error


if __name__ == "__main__":
    import sys
    body = fetch(sys.argv[1])
    print(f"{len(body)} bytes from {sys.argv[1]}")
`;

const YAML_HEAD = `---
# Helm values for orders-api, staging only
replicaCount: 2
image:
  repository: registry.example.com/orders-api
  tag: "2026.11.04-3"
  pullPolicy: IfNotPresent
database:
  host: db.staging.internal
  port: 5432
  user: orders_app
`;

const YAML_TAIL = `  pool:
    min: 2
    max: 10
    idleTimeoutSeconds: 30
redis:
  url: redis://cache.staging.internal:6379/2
resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: "1"
    memory: 512Mi
ingress:
  enabled: true
  host: orders.staging.example.com
  tls: true
featureFlags:
  newCheckout: true
  splitPayments: false
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "9102"
`;

/** The sample password that revision 1 leaked and revision 2 replaced. */
export const SAMPLE_PASSWORD = "winter-" + "kettle-42";

/** Revision 1 of Wq8nZ4Fc: holds the password. Purged, so it is never served — it
 *  exists so the fixture's revision 1 hash is the hash of the real original. */
export const YAML_REV1 = `${YAML_HEAD}  password: ${SAMPLE_PASSWORD}\n${YAML_TAIL}`;

/** Revision 2: what the URL serves after the redaction. */
export const YAML_REV2 = `${YAML_HEAD}  password: «redacted:password»\n${YAML_TAIL}`;

export const SQL = `-- Weekly retention cohorts for the Q3 review
-- Linked from the Q3 retention design doc; keep this exact text.
WITH first_orders AS (
  SELECT
    customer_id,
    date_trunc('week', min(created_at)) AS cohort_week
  FROM orders
  WHERE created_at >= DATE '2026-07-01'
    AND created_at <  DATE '2026-10-01'
    AND status = 'paid'
  GROUP BY customer_id
),
activity AS (
  SELECT
    f.cohort_week,
    floor(extract(epoch FROM o.created_at - f.cohort_week) / 604800) AS week_n,
    count(DISTINCT o.customer_id) AS active
  FROM first_orders f
  JOIN orders o USING (customer_id)
  WHERE o.status = 'paid'
  GROUP BY 1, 2
)
SELECT cohort_week, week_n, active
FROM activity
WHERE week_n BETWEEN 0 AND 12
ORDER BY cohort_week, week_n;
`;

export const BASH = `#!/bin/bash
# rotate the staging TLS cert and restart the edge pods
set -euo pipefail

NAMESPACE="edge-staging"
CERT_NAME="edge-tls"

kubectl -n "$NAMESPACE" create secret tls "$CERT_NAME" \\
  --cert=./certs/fullchain.pem --key=./certs/privkey.pem \\
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NAMESPACE" rollout restart deployment/edge
kubectl -n "$NAMESPACE" rollout status deployment/edge --timeout=120s
echo "rotated $CERT_NAME in $NAMESPACE"
`;

export const DOCKER = `# build image for the CI runners
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
USER nonroot
CMD ["dist/server.js"]
`;

export const NOTES = `Incident call, 11 Nov, checkout latency

Started 14:05 UTC when the payments provider slowed down.
Retries piled up because every client retried at the same moment.
Fix in place: full jitter on the retry wait, see the paste from 9 Nov.

Owners
  retry change: deepika
  dashboard for p99 by provider: marcus
  provider follow-up: tomas

Open questions
  Do we cap retries per request or per client?
  Should the checkout page show a slower spinner instead of an error?

Next check-in tomorrow at 10:00 UTC.
Nothing here is a decision yet.
`;

export const LAPTOP = `Laptop setup, my notes

1. Install the CLI tools from the internal catalogue.
2. Clone the monorepo into ~/src, not into iCloud.
3. Ask for the staging VPN profile in the IT channel.
4. Run ./bootstrap.sh and wait about 20 minutes.

Things I keep forgetting
  The proxy needs the corporate CA bundle.
  Docker Desktop wants 8 GB of memory or the build dies.

Delivery address for the replacement charger:
  Olek, 12 Example Street, Flat 3
  Sample Town, AB1 2CD

If the bootstrap fails on step 4, delete ~/.cache/bootstrap and run it again.
`;

// ---------------------------------------------------------------- seeded generators

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(r: () => number, a: readonly T[]): T =>
  a[Math.floor(r() * a.length)];
const hex = (r: () => number, n: number) =>
  Array.from(
    { length: n },
    () => "0123456789abcdef"[Math.floor(r() * 16)],
  ).join("");
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const stamp = (ms: number) => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}Z`
  );
};

/** A service log: ISO timestamps, levels, and a Java stack trace every ~16 lines.
 *  The stack trace is why the detection ladder needs its own log rung — any scorer
 *  reads these frames as Java and mis-highlights the rest (§A.1). */
const logLines = (
  seed: number,
  count: number,
  startMs: number,
  service: string,
) => {
  const r = rng(seed);
  const paths = [
    "/v1/charges",
    "/v1/refunds",
    "/v1/customers",
    "/v1/charges/capture",
    "/healthz",
  ] as const;
  const out: string[] = [];
  let t = startMs;
  while (out.length < count) {
    t += Math.floor(r() * 900) + 40;
    const roll = r();
    if (roll < 0.06 && out.length < count - 9) {
      out.push(
        `${stamp(t)} ERROR ${service} upstream failed id=${hex(r, 12)} path=${pick(r, paths)} status=502 dur=${5000 + Math.floor(r() * 40)}ms`,
      );
      out.push("java.net.SocketTimeoutException: Read timed out");
      out.push(
        "\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)",
      );
      out.push(
        "\tat com.example.payments.client.ProviderClient.post(ProviderClient.java:142)",
      );
      out.push(
        "\tat com.example.payments.charges.ChargeService.capture(ChargeService.java:87)",
      );
      out.push(
        "\tat com.example.payments.http.ChargeHandler.handle(ChargeHandler.java:51)",
      );
    } else if (roll < 0.16) {
      out.push(
        `${stamp(t)} WARN  ${service} slow upstream id=${hex(r, 12)} path=${pick(r, paths)} dur=${1200 + Math.floor(r() * 2800)}ms retry=${1 + Math.floor(r() * 3)}`,
      );
    } else {
      out.push(
        `${stamp(t)} INFO  ${service} request id=${hex(r, 12)} path=${pick(r, paths)} status=200 dur=${20 + Math.floor(r() * 180)}ms`,
      );
    }
  }
  return out.slice(0, count).join("\n") + "\n";
};

export const PAY_LOG = logLines(
  25,
  412,
  Date.parse("2026-11-12T07:41:00Z"),
  "payments-api",
);

/** The first 200 lines of an 18 420-line run: the highlighting-off case. */
export const INGEST_LOG = logLines(
  52,
  200,
  Date.parse("2026-11-10T16:02:00Z"),
  "ingest-worker",
);

/** The first 500 lines of a 214 880-line log: the truncated-view case. */
export const KUBE_LOG = logLines(
  91,
  500,
  Date.parse("2026-11-12T10:30:00Z"),
  "checkout-7f4",
);

/** A Slack-shaped token, built by concatenation. A sample, not a credential. */
const SLACK_TOKEN =
  "xo" +
  "xb-" +
  "1234567890123-1234567890123-" +
  "SAMPLEsample" +
  "SAMPLEsample";

/** Smoke-test output that dumps the environment on failure, putting a token on line
 *  88. The paste the moderation queue's open secret request is about. */
export const SMOKE = (() => {
  const r = rng(310);
  const lines = [
    "$ ./smoke.sh staging",
    "smoke: 64 checks against orders.staging.example.com",
    "",
  ];
  const calls = [
    "GET /v1/orders",
    "POST /v1/orders",
    "GET /v1/orders/{id}",
    "GET /healthz",
    "POST /v1/refunds",
  ] as const;
  for (let i = 1; i <= 64; i += 1) {
    lines.push(
      `check ${pad(i, 2)}  ${pick(r, calls)}  ${i === 17 || i === 41 ? "FAIL" : "ok  "}  ${30 + Math.floor(r() * 220)}ms`,
    );
  }
  lines.push(
    "",
    "smoke: 2 checks failed, dumping the environment for the report",
  );
  lines.push(
    "APP_ENV=staging",
    "REGION=eu-west-1",
    "LOG_LEVEL=info",
    "RELEASE=2026.11.02-1",
    "NODE_ENV=production",
    "ORDERS_DB_HOST=db.staging.internal",
    "ORDERS_DB_PORT=5432",
    "ORDERS_DB_NAME=orders",
    "REDIS_URL=redis://cache.staging.internal:6379/2",
    "PROVIDER_BASE_URL=https://sandbox.payments.example.com",
    "PROVIDER_TIMEOUT_MS=5000",
    "RETRY_MAX=6",
    "RETRY_BASE_MS=500",
    "FEATURE_NEW_CHECKOUT=true",
    "FEATURE_SPLIT_PAYMENTS=false",
    "METRICS_PORT=9102",
    "TRACE_SAMPLE_RATE=0.1",
    "SLACK_CHANNEL=#orders-staging",
  );
  lines.push(`SLACK_BOT_TOKEN=${SLACK_TOKEN}`); // line 88
  while (lines.length < 124) {
    lines.push(
      `trace ${hex(r, 8)}  ${pick(r, ["connect", "tls", "request", "response"] as const)}  ${Math.floor(r() * 90)}ms`,
    );
  }
  return lines.join("\n") + "\n";
})();

/** The local copy someone kept of a paste whose bytes are gone. The purged receipt
 *  shows a hash; this is the text that hash is of, so "if you have a local copy, the
 *  hash confirms it is the same text" can actually be demonstrated (§6.3). */
export const FLAKY_COPY = (() => {
  const r = rng(77);
  const lines = [
    "============================= test session starts ==============================",
    "platform linux -- Python 3.12.6, pytest-8.3.3",
    "collected 214 items",
    "",
  ];
  for (let i = 0; i < 18; i += 1) {
    lines.push(
      `tests/test_checkout.py::test_case_${pad(i + 1, 3)} ${r() < 0.12 ? "FAILED" : "PASSED"}${" ".repeat(6)}[${pad(Math.round(((i + 1) / 214) * 100), 3)}%]`,
    );
  }
  lines.push(
    "",
    "FAILED tests/test_checkout.py::test_case_007 - TimeoutError: provider took 5.02s",
    "======================== 1 failed, 17 passed in 41.82s ========================",
  );
  return lines.join("\n") + "\n";
})();
