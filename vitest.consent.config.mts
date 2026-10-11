import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

// Explicit local-provider gate; never part of the pure unit suite or hosted tests.
export default defineConfig({ ...base, test: {
  ...base.test, include: ["scripts/fixtures/consent-handoff.test.ts"], maxWorkers: 1,
  testTimeout: 30000, hookTimeout: 60000,
} });
