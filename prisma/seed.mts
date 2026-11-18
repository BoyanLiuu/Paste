// Additive seed: the fixture users, so a fresh clone can create a paste immediately.
//
// ADDITIVE AND IDEMPOTENT, always. Dev and production share the `paste` schema
// (ARCHITECTURE Appendix B), so the usual seed shape — truncate, then insert — would
// destroy live data every time someone ran it. There is no staging copy to be wrong
// against. `skipDuplicates` inserts what is missing and touches nothing that exists.
//
// Running this is optional: `userIdFor` upserts the viewer on demand, so the first create
// works without it. It exists so `/list/:username` has people to list before anything has
// been posted.

import "dotenv/config";

import { prisma } from "@/lib/server/prisma";
import { seedUsers } from "@/lib/server/users";

async function main() {
  const before = await prisma.user.count();
  const { created } = await seedUsers();
  const after = await prisma.user.count();

  process.stdout.write(
    `users: ${before} -> ${after} (${created} inserted, ${after - created === before ? "none" : "some"} already present)\n`,
  );

  // Say plainly what was NOT done, so nobody assumes a seeded database has content.
  const pastes = await prisma.paste.count();
  process.stdout.write(
    `pastes: ${pastes} — the seed creates none. Every paste must go through the create\n` +
      `path so it gets scanned (§6.1); inserting rows directly would bypass that and is\n` +
      `exactly the shortcut the scan-before-insert ordering exists to prevent.\n`,
  );

  await prisma.$disconnect();
}

await main();
