import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./src/test/global-setup.ts",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://mams:mams@localhost:5433/mams_test",
      BETTER_AUTH_SECRET: "test-secret-0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:8080",
      JOB_TRIGGER_TOKEN: "test-job-token-0123456789",
    },
    fileParallelism: false, // tests share one Postgres database
    testTimeout: 20000,
  },
});
