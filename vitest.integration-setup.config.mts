import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";
export default defineConfig({ ...base, test: { ...base.test, include: ["scripts/fixtures/integration-setup.test.ts"],
  maxWorkers: 1, testTimeout: 60000, hookTimeout: 120000 } });
