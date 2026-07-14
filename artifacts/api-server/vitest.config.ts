import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests share the dev database; run files serially to avoid interference.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Tests mock Clerk's getAuth via the x-test-clerk-user header.
    // AUTH_MODE must be "clerk" so requireAuth delegates to the Clerk path
    // (where the mock intercepts), not to localAuth which ignores the header.
    env: { AUTH_MODE: "clerk" },
  },
});
