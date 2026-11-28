import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // The CLI and anvil suites run real processes and chains; under a loaded machine a blocking CLI call
    // can take well over vitest's 5 s default, so a slow machine must not read as a failure.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      reporter: ["text", "json-summary"],
      // NFR-04: the verifier and the policy engine have 100% branch coverage.
      thresholds: {
        "packages/core/src/verifier.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "packages/core/src/policy.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "packages/core/src/agents.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
