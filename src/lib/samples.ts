// Bodies the create form can be preloaded with via ?sample=, so every designed state
// is reachable by URL rather than by typing the right thing.
//
// Each is a case from the plan's own tests: a clean file, a log, a tier-1 block, a
// tier-2 override, and a body over the cap. The two credential-shaped ones are
// assembled at runtime from parts — never stored whole — which is the rule
// no-committed-secrets.spec.ts enforces.

import { PAY_LOG, PY, SAMPLE_PASSWORD } from "@/lib/fixtures/bodies";

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
    label: "11 MB of log",
    title: "",
    oversized: true,
  },
};
