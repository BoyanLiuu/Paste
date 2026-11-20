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

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Page } from "@playwright/test";

import { EXPIRED_SUBJECT_ID, LIVE_SUBJECT_ID } from "./shot-subjects.mjs";

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
    // The 410. The paste is gone and the URL still answers with who made it, when, how
    // big it was and the SHA-256 of the bytes.
    name: "expired",
    path: `/p/${EXPIRED_SUBJECT_ID}`,
    // `main` has `flex-1`, so it fills the viewport and the receipt floats in the top
    // half of it. The tombstone's own container hugs what it prints.
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

      await page.getByText(shot.waitFor, { exact: false }).first().waitFor({
        state: "visible",
        timeout: 15_000,
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

      const file = path.join(OUT, `${shot.name}.png`);
      await page.screenshot({ path: file, clip: await padded(page, shot) });
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
    console.error(`\n${failures.length} shot(s) failed:`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log(`\n${SHOTS.length} shots written to public/shots/`);
}

await main();
