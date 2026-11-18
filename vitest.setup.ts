// Loaded before every test file.
//
// `dotenv/config` is first and is load-bearing: vitest does not read `.env` on its own
// (Vite only exposes `VITE_`-prefixed values, and only on `import.meta.env`). Without it
// the database tests find no DIRECT_URL and skip — which is the quiet failure mode where
// the suite reports green while the immutability trigger goes unchecked.
import "dotenv/config";

import "@testing-library/jest-dom/vitest";
