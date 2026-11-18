import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright owns tests/e2e; vitest would try to run those as unit tests.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    // The service layer imports `server-only`, which throws by design outside a React
    // Server Component environment. Its exports map sends this condition to an empty
    // module, so the guard still protects the app build while the unit suite can import
    // the same files. Stubbing the package instead would hide a real misuse.
    conditions: ["react-server"],
  },
  ssr: {
    resolve: {
      // The same condition again, for files that opt into `@vitest-environment node`.
      //
      // `resolve.conditions` above only covers the web/jsdom graph, so a node-environment
      // spec resolved `server-only` to its default export and threw on import. Which
      // forced every Prisma test into jsdom — where Shiki's oniguruma WASM cannot load,
      // so stage 8's render failed silently and the create path's render was never
      // actually exercised by anything. Two unrelated-looking problems, one cause.
      conditions: ["react-server"],
    },
  },
});
