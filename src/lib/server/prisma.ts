// The one Prisma client, over the node-postgres driver adapter.
//
// SERVER ONLY. ARCHITECTURE §6.5 makes "the browser never talks to the database" a
// structural property rather than a convention, and this module is where that would be
// lost first, so it fails loudly instead of leaking a connection string into a bundle.

// The guard, and the same one every other module under src/lib/server uses.
//
// This replaced a `typeof window !== "undefined"` throw, which was worse in both
// directions: it only fires once the module has already been bundled and shipped, and it
// fires spuriously under jsdom, where `window` exists and there is no browser. The
// package's exports map sends the `react-server` condition to an empty module, so the
// build fails on a client import while the server and the unit suite both resolve it.
import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    // Named explicitly, because the alternative is a Prisma error about an invalid
    // datasource that says nothing about which variable is missing from .env.
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return url;
}

/**
 * Pool size, which is a deployment property and not a preference.
 *
 * On Vercel each concurrent invocation is its own process with its own pool, so the
 * ceiling that matters is (instances × max), not `max`. Supabase's transaction pooler
 * sits in front of a Postgres with a connection limit the free tier reaches quickly.
 * Six per instance against the pooler is the figure .env.example documents; locally,
 * where the session pooler stands in for it, a smaller pool is honest about the fact
 * that nothing here is concurrent.
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? "3");

function create(): PrismaClient {
  return new PrismaClient({
    // The driver adapter, not a Prisma-managed connection. This is what lets the pool be
    // configured at all, and it is why `url` cannot live in schema.prisma under Prisma 7.
    adapter: new PrismaPg({
      connectionString: connectionString(),
      max: POOL_MAX,
    }),
    // Warnings in development, errors everywhere. Deliberately no `"query"`, in either
    // environment: a query log for this schema prints paste titles and bodies, and
    // development points at the same database production does.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Cached on globalThis, because Next's dev server re-evaluates modules on every edit and
// a fresh pool per edit exhausts the database's connection limit within a few saves.
// Production evaluates once, so the cache is inert there — the global exists for the dev
// loop, not as shared request state (a client holds no per-request data).
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
