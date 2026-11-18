import { describe, expect, it } from "vitest";

import { resolveLanguage } from "@/lib/detect/ladder";
import { detectLog } from "@/lib/detect/log-detector";
import { languageForFilename } from "@/lib/detect/extensions";
import {
  BASH,
  DOCKER,
  INGEST_LOG,
  LAPTOP,
  NOTES,
  PAY_LOG,
  PY,
  SQL,
  YAML_REV2,
} from "@/lib/fixtures/bodies";

// The corpus the plan names, with the answers it requires.
//
// The load-bearing cases are the three that an auto-detector gets confidently wrong: a
// Java stack trace is not Java, a syslog dump is not C, and a minified bundle is not
// worth highlighting. §A.1's whole argument is that answering "log" beats correctly
// identifying the embedded language.

const JAVA_TRACE = `2026-11-12T07:41:03.188Z ERROR payments-api upstream failed status=502
java.net.SocketTimeoutException: Read timed out
\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)
\tat com.example.payments.client.ProviderClient.post(ProviderClient.java:142)
\tat com.example.payments.charges.ChargeService.capture(ChargeService.java:87)
2026-11-12T07:41:04.201Z ERROR payments-api upstream failed status=502
java.net.SocketTimeoutException: Read timed out
\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)
\tat com.example.payments.http.ChargeHandler.handle(ChargeHandler.java:51)
`;

const SPRING_TRACE = `Exception in thread "main" java.lang.IllegalStateException: boom
\tat com.example.App.start(App.java:31)
\tat com.example.App.main(App.java:12)
Caused by: java.io.IOException: closed
\tat java.base/java.io.FileInputStream.read(FileInputStream.java:271)
\t... 14 more
2026-11-12 07:41:03 ERROR c.e.App - startup aborted
2026-11-12 07:41:03 INFO  c.e.App - shutting down
2026-11-12 07:41:04 INFO  c.e.App - bye
`;

const PYTHON_TRACE = `2026-11-12 07:41:03,188 ERROR worker failed job=4821
Traceback (most recent call last):
  File "/app/worker.py", line 88, in run
    handle(job)
  File "/app/handlers.py", line 31, in handle
    raise TimeoutError("provider took 5.02s")
TimeoutError: provider took 5.02s
2026-11-12 07:41:04,002 INFO  worker picking up job=4822
2026-11-12 07:41:04,551 INFO  worker finished job=4822
`;

const SYSLOG = `Nov 12 07:41:03 host-7 sshd[2241]: Accepted publickey for deploy from 10.0.3.19
Nov 12 07:41:04 host-7 sshd[2241]: pam_unix(sshd:session): session opened for user deploy
Nov 12 07:41:09 host-7 systemd[1]: Started Session 4812 of user deploy
Nov 12 07:41:31 host-7 kernel: [ 9124.552] TCP: request_sock_TCP: dropping request
Nov 12 07:42:02 host-7 cron[2303]: (deploy) CMD (/usr/local/bin/rotate-logs)
Nov 12 07:42:10 host-7 sshd[2241]: Received disconnect from 10.0.3.19 port 51022
`;

const MINIFIED = `!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):t((e="undefined"!=typeof globalThis?globalThis:e||self).lib={})}(this,function(e){"use strict";function t(e,t){return e<t?-1:e>t?1:0}function n(e){return null==e?"":String(e)}e.compare=t,e.str=n,Object.defineProperty(e,"__esModule",{value:!0})});
`;

const HELM = `---
# Helm values, templated
replicaCount: {{ .Values.replicas | default 2 }}
image:
  repository: {{ .Values.image.repo }}
  tag: "{{ .Values.image.tag }}"
resources:
  limits:
    cpu: "1"
    memory: 512Mi
`;

const PROSE = `We agreed to move the retry change behind a flag for one release.

The provider's sandbox is slower than production, so the smoke test needs a
longer timeout than the real thing. Nobody has written that down anywhere
except this paste, which is the reason it exists.

Next check-in is Thursday.
`;

describe("the ladder's required answers", () => {
  it.each([
    ["a Java stack trace in a log", JAVA_TRACE, "log"],
    ["a Spring trace with Caused by", SPRING_TRACE, "log"],
    ["a Python traceback in a log", PYTHON_TRACE, "log"],
    ["a syslog dump", SYSLOG, "log"],
    ["a fixture log", PAY_LOG, "log"],
    ["a second fixture log", INGEST_LOG, "log"],
    ["a templated Helm values file", HELM, "yaml"],
    ["prose", PROSE, "plaintext"],
    ["notes", NOTES, "plaintext"],
    ["laptop notes", LAPTOP, "plaintext"],
  ] as const)("resolves %s to %s", (_name, body, expected) => {
    expect(resolveLanguage({ body }).language).toBe(expected);
  });

  it("resolves a minified bundle to javascript or plaintext, never to something exotic", () => {
    // The honest expectation. A single 300-character line scores poorly on purpose,
    // and either answer is defensible — what matters is that it is not confidently
    // wrong, which is what the relevance floor buys.
    expect(["javascript", "plaintext"]).toContain(
      resolveLanguage({ body: MINIFIED }).language,
    );
  });

  it("resolves real source files by their first line", () => {
    expect(resolveLanguage({ body: PY })).toEqual({
      language: "python",
      source: "firstline",
    });
    expect(resolveLanguage({ body: BASH })).toEqual({
      language: "bash",
      source: "firstline",
    });
    expect(resolveLanguage({ body: DOCKER }).language).toBe("dockerfile");
  });

  it("scores SQL, which has no first line to sniff", () => {
    const detection = resolveLanguage({ body: SQL });
    expect(detection.language).toBe("sql");
    expect(detection.source).toBe("scored");
  });
});

describe("rung order", () => {
  it("lets an explicit choice win over everything", () => {
    // Rung 1 is never second-guessed: the user looked at their own text.
    expect(resolveLanguage({ body: PAY_LOG, language: "python" })).toEqual({
      language: "python",
      source: "explicit",
    });
  });

  it("treats auto as no choice at all", () => {
    expect(
      resolveLanguage({ body: PAY_LOG, language: "auto" }).source,
    ).not.toBe("explicit");
  });

  it("prefers a filename over a sniff", () => {
    expect(resolveLanguage({ body: PY, filename: "thing.rb" })).toEqual({
      language: "ruby",
      source: "filename",
    });
  });

  it("runs the log detector before the scorer", () => {
    // The ordering that matters most. A scorer handed JAVA_TRACE answers "java"; the
    // ladder must answer "log" because the log rung comes first.
    expect(resolveLanguage({ body: JAVA_TRACE }).language).toBe("log");
  });

  it("falls through to plaintext rather than guessing", () => {
    const detection = resolveLanguage({ body: "one\ntwo\nthree\n" });
    expect(detection).toEqual({ language: "plaintext", source: "fallback" });
  });
});

describe("the log detector", () => {
  it.each([
    ["timestamps", SYSLOG],
    ["levels and traces", SPRING_TRACE],
  ] as const)("recognises %s", (_name, body) => {
    expect(detectLog(body).isLog).toBe(true);
  });

  it.each([
    ["python source", PY],
    ["a yaml file", YAML_REV2],
    ["prose", PROSE],
    ["a minified bundle", MINIFIED],
  ] as const)("does not mistake %s for a log", (_name, body) => {
    expect(detectLog(body).isLog).toBe(false);
  });

  it("needs more than two lines to judge", () => {
    // One timestamped line is a date, not a log.
    expect(detectLog("2026-11-12T07:41:03Z INFO up\n").isLog).toBe(false);
  });

  it("reports a confidence, which is the override-rate signal §A.1 asks for", () => {
    expect(detectLog(SYSLOG).confidence).toBeGreaterThan(0.9);
    expect(detectLog(PROSE).confidence).toBeLessThan(0.2);
  });
});

describe("filenames", () => {
  it.each([
    ["deploy.yaml", "yaml"],
    ["retry_backoff.py", "python"],
    ["Dockerfile", "dockerfile"],
    ["Makefile", "makefile"],
    ["values-staging.yaml.j2", "yaml"],
    ["src/app/page.tsx", "tsx"],
    ["notes.txt", "plaintext"],
    ["run.log", "log"],
  ])("maps %s to %s", (filename, expected) => {
    expect(languageForFilename(filename)).toBe(expected);
  });

  it("ignores a directory that looks like an extension", () => {
    // A path should not let a folder decide the language.
    expect(languageForFilename("python/notes.txt")).toBe("plaintext");
  });

  it("returns null when it does not know", () => {
    expect(languageForFilename("thing.wat")).toBeNull();
    expect(languageForFilename("")).toBeNull();
  });
});
