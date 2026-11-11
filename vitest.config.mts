import { defineConfig } from "vitest/config";

// Two test projects:
//   unit — pure TypeScript logic, no network or database (npm test)
//   db   — RLS, constraints and SQL functions against a real PostgreSQL
//          server started by scripts/test-db.sh (npm run test:db)
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          // DB tests share one database; run files sequentially.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
