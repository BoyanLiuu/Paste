// Bodies the create form can be preloaded with via ?sample=, so every designed state
// is reachable by URL rather than by typing the right thing.
//
// Each is a case from the plan's own tests: a clean file, a log, a tier-1 block, a
// tier-2 override, and a body over the cap. The two credential-shaped ones are
// assembled at runtime from parts — never stored whole — which is the rule
// no-committed-secrets.spec.ts enforces.

import { formatBytes } from "@/lib/format";
import { MAX_BYTES } from "@/lib/render/thresholds";

import { PAY_LOG, PY, SAMPLE_PASSWORD } from "@/lib/fixtures/bodies";

/**
 * A body deliberately over the cap, for the refusal the form has to show.
 *
 * Built rather than stored: a 27 MB string literal in source is absurd, and it would also
 * have to change every time the ceiling does. Constructed on demand, in the browser —
 * shipping it over the wire was a real bug once, 20.8 MB on a page load to demonstrate a
 * limit.
 */
const OVERSIZE_LINE =
  "2026-11-12T07:41:03.188Z INFO payments-api request status=200\n";

/** How far past the cap the sample goes. One place, so the label and the body agree. */
const OVERSIZE_FACTOR = 1.1;

export function buildOversizedBody(): string {
  return OVERSIZE_LINE.repeat(
    Math.ceil((MAX_BYTES * OVERSIZE_FACTOR) / OVERSIZE_LINE.length),
  );
}

/** The real byte length of what `buildOversizedBody` produces, without building it. */
function oversizedBodyBytes(): number {
  const lines = Math.ceil((MAX_BYTES * OVERSIZE_FACTOR) / OVERSIZE_LINE.length);
  return lines * OVERSIZE_LINE.length;
}

/** A sample AWS key id. AWS publishes EXAMPLE-suffixed keys for documentation and
 *  scanners exclude them, but it is still assembled rather than written whole so the
 *  guard has nothing to object to and the habit stays uniform. */
const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

export interface Sample {
  label: string;
  title: string;
  body?: string;
  /** Build the body in the browser instead of sending it. Only the over-the-cap
   *  sample uses this: serialising 10 MB to demonstrate a 10 MB limit sent 20.8 MB
   *  down the wire, because the body lands in both the rendered textarea and the RSC
   *  payload that hydrates it. */
  oversized?: boolean;
}

export const SAMPLE_BODIES: Readonly<Record<string, Sample>> = {
  python: {
    label: "clean Python",
    title: "retry_backoff.py",
    body: PY,
  },
  log: {
    label: "a log",
    title: "",
    // 60 lines is enough to show the log treatment without filling the textarea.
    body: PAY_LOG.split("\n").slice(0, 60).join("\n") + "\n",
  },
  aws: {
    label: "an AWS key",
    title: "",
    body:
      `[default]\n` +
      `region = eu-west-1\n` +
      `aws_access_key_id = ${AWS_KEY}\n` +
      `aws_secret_access_key = <your-secret-here>\n` +
      `output = json\n`,
  },
  password: {
    label: "a password",
    title: "",
    body:
      `# .env for the local checkout stack\n` +
      `APP_ENV=development\n` +
      `DB_HOST=localhost\n` +
      `DB_PASSWORD="${SAMPLE_PASSWORD}"\n` +
      `LOG_LEVEL=debug\n`,
  },
  huge: {
    // DERIVED FROM THE BODY ITSELF, not written down and not recomputed.
    //
    // It said "11 MB of log", true against the old 10 MB ceiling and wrong the moment the
    // limit moved to 25 MB — the same rot as the fixture dates when they were absolute.
    //
    // The first fix computed `formatBytes(MAX_BYTES * 1.1)` here while `create-form.tsx`
    // separately built a body of `MAX_BYTES * 1.1`, which replaced one duplication with
    // another: two places deciding how far over the cap to go, free to disagree and make
    // the label lie again. The builder lives here now and the label measures its output.
    // NAMES ITSELF AS THE OVER-CAP CASE. "27.5 MB of log" sat directly above the form's own
    // "Up to 25.0 MB", so it read as a contradiction rather than as the refusal this sample
    // exists to demonstrate.
    label: `${formatBytes(oversizedBodyBytes())} — over the cap`,
    title: "",
    oversized: true,
  },
};
