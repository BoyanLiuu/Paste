/**
 * Captures the product screenshots the landing page ships.
 *
 * A SCRIPT RATHER THAN A FOLDER OF PNGS SOMEONE ONCE SAVED. The 58 `ux-*.png` renders in
 * the docs folder are the cautionary case: they were right when they were made, the app
 * moved, and nothing told anyone. PRODUCT.md now has to carry a note saying they must not
 * ship. The same thing happens to marketing screenshots faster, because they live on the
 * page a stranger sees first.
 *
 * So the home page's evidence is reproducible: `pnpm shots` against a running dev server
 * re-captures every image from the real routes. If a screenshot and the product disagree,
 * that is a one-command fix rather than an archaeology problem.
 *
 * THE SUBJECTS ARE REAL ROWS, not fixtures dressed up for the camera. `AerfZDG4` and
 * `fPQDvfje` are pastes in the development database; the refusal is the live client scan
 * running over the `aws` sample, which is how any visitor reaches that state.
 *
 *   pnpm dev                      # in one terminal
 *   pnpm shots                    # in another
 *
 * Fails loudly on a missing route or a state that never appeared, because a 404 page
 * screenshotted at 2x is still a 200 as far as the file system is concerned.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { LIVE_SUBJECT_ID, PURGED_SUBJECT_ID } from "@/lib/shot-subjects";

const ORIGIN = process.env.SHOTS_ORIGIN ?? "http://localhost:3025";
const OUT = path.join(process.cwd(), "public", "shots");

/** 2x, so the images stay sharp on the displays most people read a landing page on. */
const SCALE = 2;

interface Shot {
  readonly name: string;
  readonly path: string;
  /** Clipped to this element, so the shot carries no browser chrome and no page padding. */
  readonly clip: string;
  readonly width: number;
  readonly height: number;
  /** Text that must be on screen before the shutter opens. */
  readonly waitFor: string;
  readonly prepare?: (page: Page) => Promise<void>;
}

const SHOTS: readonly Shot[] = [
  {
    // What user B sees after following a link: highlighted, numbered, and with lines 4–8
    // selected from the fragment — the state a `#L4-L8` link in a ticket resolves to.
    name: "read",
    path: `/p/${LIVE_SUBJECT_ID}#L4-L8`,
    // The reading column only. `main` would drag in the metadata aside, which is a
    // different claim and leaves the left half empty below the code.
    clip: "main > div > div:nth-child(1)",
    // 1440 IS AS WIDE AS THIS GETS, which is worth writing down because the obvious fix
    // for a small shot — capture at a bigger viewport — does nothing here. `container-page`
    // caps at `--container: 1440px`, so past that the reading column stops growing at
    // about 920 CSS pixels and the extra viewport becomes margin. The hero is laid out
    // around that number rather than scaling the image up to meet it.
    width: 1440,
    height: 1000,
    waitFor: "Copy link",
    // CROPPING, DONE IN THE DOM. The reading column is a grid item, so it stretches to
    // the height of the taller metadata aside beside it and the clip came out 40% empty.
    // Removing the sibling lets the column hug its own content. This takes nothing out of
    // the shot itself — the aside is a separate claim with its own section.
    prepare: async (page) => {
      await page.evaluate(() => {
        document.querySelector("main aside")?.remove();
      });
    },
  },
  {
    // THE PURGED RECEIPT, which is what the landing page's second section actually claims.
    // It used to point at the merely-expired subject, whose own page reads "The bytes are
    // still here until …" — directly contradicting the copy beside it about a hash that
    // outlives the bytes. This one's bytes are destroyed and its hash is not.
    name: "purged",
    path: `/p/${PURGED_SUBJECT_ID}`,
    clip: "main > div",
    width: 1120,
    height: 900,
    waitFor: "SHA-256",
  },
  {
    // The refusal, mid-typing, signed out. No row is written and no id is issued.
    name: "refused",
    path: "/new?sample=aws",
    // `main` carries `flex-1`, so clipping to it adds however much viewport is left over
    // below the form — 500px of empty page on the first attempt.
    clip: "main > div",
    width: 1120,
    height: 1100,
    waitFor: "This cannot be saved",
  },
  {
    // The retention panel: the expiry and purge dates, before the paste has a link.
    name: "retention",
    path: "/new?sample=python",
    clip: "main aside",
    // NARROW ON PURPOSE, and this is the mirror of the hero's problem. Inside the
    // two-column form this panel is a fixed 22rem — 352 CSS pixels — so a page section
    // would have to scale it up by 1.7x to fill a column, and an upscaled screenshot of
    // 13px type looks like a photograph of a screen. Below the `lg` breakpoint the form
    // is one column and the panel spans it, which is the same component at a readable
    // size rather than a magnified one.
    width: 1000,
    height: 1200,
    waitFor: "Before it gets a link",
  },
];

/** Breathing room around the clipped element, in CSS pixels. */
const PAD = 28;

/**
 * The clip rectangle: the element's box, grown by `PAD` and clamped to the viewport.
 *
 * `locator.screenshot()` CROPS EXACTLY TO THE BORDER BOX, which put the 410 receipt's
 * right-aligned values flush against the edge of the file — the layout's own padding lives
 * on an ancestor, so clipping to a descendant throws it away. Growing the rectangle gives
 * every shot the same margin regardless of which element it was clipped to, which is also
 * what lets them sit beside each other on the page without looking like four crops from
 * four different tools.
 */
async function padded(page: Page, shot: Shot) {
  const box = await page.locator(shot.clip).first().boundingBox();
  if (box === null) throw new Error(`${shot.clip} has no box`);

  // THE CLIP MUST CONTAIN THE WHOLE ELEMENT. `boundingBox` is viewport-relative, and with
  // `fullPage` the clip is read as document coordinates — equal only while the page has not
  // scrolled, which this script never does. Asserted rather than assumed, because a silent
  // mismatch crops the subject and the output still looks like a finished screenshot.
  const scrolled = await page.evaluate(() => window.scrollY);
  if (scrolled !== 0)
    throw new Error(`page scrolled to ${scrolled} before capture`);

  // CLAMPED TO `main`, not to the viewport. Growing the rectangle by PAD alone reached up
  // past the top of the content area and pulled the bottom 8px of the app header into the
  // shot — a sliver of wordmark and a half-cut "Sign in", which reads as a botched crop.
  // `main`'s own padding is the room the layout already reserves, so it is the limit.
  const bounds = (await page.locator("main").first().boundingBox()) ?? {
    x: 0,
    y: 0,
    width: shot.width,
    height: shot.height,
  };

  const left = Math.max(bounds.x, box.x - PAD);
  const top = Math.max(bounds.y, box.y - PAD);

  return {
    x: left,
    y: top,
    width: Math.min(bounds.x + bounds.width - left, box.width + PAD * 2),
    height: Math.min(bounds.y + bounds.height - top, box.height + PAD * 2),
  };
}

/** Where the generated size manifest lands. */
const MANIFEST = path.join(
  process.cwd(),
  "src",
  "lib",
  "shot-sizes.generated.ts",
);

/**
 * Renames a capture to include a hash of its own bytes, and removes its predecessors.
 *
 * CONTENT-ADDRESSED, BECAUSE A STABLE FILENAME IS A STALE IMAGE. Rewriting `read.png` in
 * place left the browser and `/_next/image` serving the previous capture from cache — the
 * page showed the old subject under the new caption, which is worse than showing nothing
 * because it reads as correct. Locally that is an annoyance; on Vercel, `public/` is served
 * with a long max-age and the image optimizer caches per URL, so a deploy that changes a
 * screenshot without changing its name serves the old one to anyone who has seen it.
 *
 * The hash is of the PNG itself, so re-running with no visual change produces the same name
 * and no churn in git — with one expected exception. `refused` and `retention` both contain
 * the expiry panel, whose date is `NOW + 30 days` against `NOW = Date.now()`, so those two
 * genuinely differ every day and will take a new hash on each run. That is the panel being
 * correct rather than the hashing being unstable: a form that showed a frozen date would be
 * lying about what the visitor is agreeing to.
 */
async function fingerprint(name: string): Promise<{
  file: string;
  width: number;
  height: number;
}> {
  const temp = path.join(OUT, `${name}.tmp.png`);
  const bytes = await readFile(temp);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const file = `${name}.${hash}.png`;

  // Drop any earlier generation of this shot before writing the new one, so the folder
  // never accumulates orphans nothing references.
  await rename(temp, path.join(OUT, file));

  return {
    file,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

/**
 * Writes the dimensions the page declares to `next/image`.
 *
 * GENERATED, BECAUSE TYPING THEM IN WENT WRONG TWICE IN ONE SESSION. `page.tsx` held four
 * hand-written `width`/`height` pairs. A layout fix made the retention panel span its column,
 * so its capture went from 816x918 to 1856x614 — and the declaration did not move, which
 * rendered that screenshot at 0.44x of its captured size with a reserved box the wrong shape.
 * `read.png` had drifted too: declared 1126 tall against a real 1514.
 *
 * Both are the failure Appendix H already names, and the same one `measure-thresholds.mts`
 * and the expiry panel's rule count exist to answer: a value written down rather than
 * computed rots silently. So `pnpm shots` now emits the numbers it just produced, the same
 * way `rules.generated.ts` and `renders.generated.ts` are emitted, and the page reads them.
 */
/**
 * Leaves `public/shots/` holding exactly the files the manifest names.
 *
 * PRUNED AGAINST THE MANIFEST, not per shot name, which is the difference between this and
 * the first version. That one deleted `read.<oldhash>.png` when it wrote a new `read.*`, so
 * it handled a changed capture and nothing else: renaming a shot left the old name's file
 * orphaned for good — which happened the day `expired` became `purged` and had to be
 * cleaned up by hand. It also stranded `*.tmp.png` whenever a later shot failed, because
 * the rename that consumes a temporary never ran.
 *
 * Anything in the folder that the manifest does not name is, by definition, a file no page
 * can reference.
 */
async function prune(keep: readonly string[]) {
  const wanted = new Set(keep);
  for (const existing of await readdir(OUT)) {
    if (!existing.endsWith(".png") || wanted.has(existing)) continue;
    await unlink(path.join(OUT, existing));
    console.log(`  removed    ${existing}`);
  }
}

async function writeManifest(names: readonly string[]) {
  const entries: string[] = [];
  const files: string[] = [];
  for (const name of [...names].sort()) {
    const { file, width, height } = await fingerprint(name);
    files.push(file);
    // UNQUOTED KEY WHEN IT IS A VALID IDENTIFIER, because the emitted file has to satisfy
    // `prettier --check .` like `rules.generated.ts` does — a generated file that fails the
    // format gate makes every contributor's first commit red for a reason they did not cause.
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
    entries.push(
      `  ${key}: { file: "${file}", width: ${width}, height: ${height} },`,
    );
  }

  await writeFile(
    MANIFEST,
    `// GENERATED BY \`pnpm shots\` — do not hand-edit.
//
// The filename and intrinsic pixel size of each capture in \`public/shots/\`. \`page.tsx\`
// declares the dimensions to \`next/image\`, which needs them to reserve the box before the
// bytes arrive and to cap each screenshot at the size it was captured at.
//
// THE FILENAME CARRIES A HASH OF THE IMAGE, so a changed capture is a new URL that no cache
// can answer with the old one. Hand-written dimensions went stale twice in one afternoon,
// and a stable filename served a stale image — see \`capture-shots.mts\` for both.

export const SHOT_SIZES = {
${entries.join("\n")}
} as const satisfies Record<
  string,
  { file: string; width: number; height: number }
>;

export type ShotName = keyof typeof SHOT_SIZES;
`,
    "utf8",
  );
  await prune(files);
  console.log(`  manifest  ${path.relative(process.cwd(), MANIFEST)}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1120, height: 900 },
    deviceScaleFactor: SCALE,
    // The app has one theme and it is dark, but asking for it explicitly keeps a
    // CI machine's OS preference out of the output.
    colorScheme: "dark",
    // Motion settles instantly, so a crossfading date cannot be caught at 40% opacity.
    reducedMotion: "reduce",
  });

  const failures: string[] = [];

  for (const shot of SHOTS) {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: shot.width, height: shot.height });

      const response = await page.goto(`${ORIGIN}${shot.path}`, {
        waitUntil: "domcontentloaded",
      });

      // A 410 IS A SUCCESS HERE, which is the whole point of the `expired` shot — so the
      // check is "not a 404 and not a 5xx" rather than `response.ok()`.
      const status = response?.status() ?? 0;
      if (status === 404 || status >= 500) {
        throw new Error(`${shot.path} answered ${status}`);
      }

      // 45s, NOT 15s. This drives `next dev`, so the first request to a route it has not
      // compiled yet pays for the compile — and after an edit that is routinely 20s or
      // more. Two runs reported the tier-1 refusal panel as absent when it was merely late,
      // which is a false failure that looks exactly like a real regression.
      await page.getByText(shot.waitFor, { exact: false }).first().waitFor({
        state: "visible",
        timeout: 45_000,
      });
      await shot.prepare?.(page);

      // THE DEV OVERLAY IS NOT PART OF THE PRODUCT. Next renders its badge into a
      // `nextjs-portal` custom element fixed to the corner of the viewport, and the
      // first run of this script put it in the top-left of a shipped screenshot.
      //
      // REMOVED FROM THE DOM RATHER THAN HIDDEN WITH CSS, because `addStyleTag` injects
      // an inline `<style>` and the view route's CSP is `style-src 'self'` (§6.5) — it
      // refused, which is the policy working. `evaluate` runs over CDP rather than as a
      // page script, so no policy applies to it.
      await page.evaluate(() => {
        document
          .querySelectorAll("nextjs-portal, [data-nextjs-toast]")
          .forEach((node) => node.remove());
      });

      // Fonts, then one frame. Without the font wait the shot can land on the fallback
      // face, which is a different design than the one that shipped.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);

      // Written under a temporary name; `fingerprint` gives it its content-addressed one.
      const file = path.join(OUT, `${shot.name}.tmp.png`);
      // `fullPage`, WITH a clip. Without it the clip is confined to the viewport, so any
      // part of the target below the fold is silently dropped — the retention panel came
      // out cut off mid-table, missing two rows and its footnote, and the file looked
      // deliberate enough that only reading it caught it. With `fullPage` the clip is in
      // document coordinates and reaches the whole element whatever the viewport height.
      await page.screenshot({
        path: file,
        clip: await padded(page, shot),
        fullPage: true,
      });
      console.log(`  ${shot.name}.png  ${shot.path}  (${status})`);
    } catch (error) {
      failures.push(
        `${shot.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await page.close();
    }
  }

  await context.close();
  await browser.close();

  if (failures.length > 0) {
    // The temporaries of whatever DID succeed are useless without a manifest naming them,
    // and `public/shots/` is committed — so they must not survive a failed run.
    for (const existing of await readdir(OUT)) {
      if (existing.endsWith(".tmp.png")) await unlink(path.join(OUT, existing));
    }
    console.error(`\n${failures.length} shot(s) failed:`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }

  await writeManifest(SHOTS.map((s) => s.name));
  console.log(`\n${SHOTS.length} shots written to public/shots/`);
}

await main();
