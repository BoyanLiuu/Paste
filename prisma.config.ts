import "dotenv/config";

import { defineConfig, env } from "prisma/config";

// Migrations read DIRECT_URL from here.
//
// Prisma 7 rejects `url` and `directUrl` inside a `datasource` block — both are hard
// validation errors and `directUrl` was removed outright — so the migrate URL lives in
// this file and the runtime URL goes to a driver adapter instead
// (src/lib/server/prisma.ts).
//
// DIRECT_URL is the SESSION pooler. `prisma migrate` cannot run over transaction-mode
// pooling, which is the whole reason there are two connection strings.
//
// `dotenv/config` is imported explicitly: the Prisma CLI reads `.env` for the schema
// but this config file is plain TypeScript and gets no environment of its own.

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
