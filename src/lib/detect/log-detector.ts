// Rung 4, and the rung every implementation omits.
//
// **Logs are the most common thing pasted into an internal paste tool, and a log is
// not a language.** Hand a Java stack trace to any auto-detector and it answers "Java"
// with confidence, then mis-highlights 80 % of the lines — because the lines are not
// Java, they are `at com.foo.Bar.baz(Bar.java:42)`.
//
// So this runs *before* the scorer (§A.1). Answering "this is a log" and applying a
// small bespoke treatment beats correctly identifying the embedded language.

/** ISO-8601, syslog "Mon DD HH:MM:SS", bracketed clock times, and bare HH:MM:SS. */
const TIMESTAMP_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/,
  /^[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}/,
  /^\[\d{2}:\d{2}:\d{2}/,
  /^\d{2}:\d{2}:\d{2}[.,]\d{3}/,
  /^\[\d{4}-\d{2}-\d{2}/,
];

const LEVEL = /^(?:DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE|NOTICE|CRIT)\b/;

/** A line that is part of a stack trace rather than a log line in its own right.
 *  Counted as log-ish so a trace-heavy body is not dragged below the threshold. */
const STACK_FRAME = /^\s+(?:at |File "|\.\.\. \d+ more|Caused by:)/;

/** Lines that open or close a trace without being frames themselves. */
const TRACE_MARKER =
  /^(?:Traceback \(most recent call last\)|Caused by:|Exception in thread |\w+(?:Error|Exception)\b.*)/;

/** Any indented line, which only counts when the line before it was log-ish.
 *
 *  A Python traceback alternates `File "..."` with the source line beneath it, and
 *  those source lines match nothing on their own — which dragged a real traceback to
 *  0.56 against a 0.60 threshold and made the ladder answer "plaintext". Treating an
 *  indented line as a continuation of a recognised one covers that, Java's
 *  `... 14 more`, and wrapped log messages, without claiming that indentation alone
 *  means anything. */
const CONTINUATION = /^\s+\S/;

/** How much of the sample has to look like a log. 60 % leaves room for the blank
 *  lines, banners and wrapped messages every real log contains. */
const THRESHOLD = 0.6;

/** Enough to judge, few enough to stay cheap on a 200 000-line body. */
const SAMPLE_LINES = 200;

export interface LogVerdict {
  isLog: boolean;
  /** The share of sampled lines that looked like a log, for the override-rate
   *  instrumentation §A.1 asks for. */
  confidence: number;
}

export function detectLog(body: string): LogVerdict {
  const sample: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    sample.push(line);
    if (sample.length >= SAMPLE_LINES) break;
  }

  if (sample.length < 3) return { isLog: false, confidence: 0 };

  let logLike = 0;
  let previousWasLogLike: boolean = false;
  for (const line of sample) {
    const standalone =
      TIMESTAMP_PATTERNS.some((pattern) => pattern.test(line)) ||
      LEVEL.test(line) ||
      STACK_FRAME.test(line) ||
      TRACE_MARKER.test(line);
    const continuation: boolean =
      !standalone && previousWasLogLike && CONTINUATION.test(line);

    if (standalone || continuation) logLike += 1;
    previousWasLogLike = standalone || continuation;
  }

  const confidence = logLike / sample.length;
  return { isLog: confidence >= THRESHOLD, confidence };
}
