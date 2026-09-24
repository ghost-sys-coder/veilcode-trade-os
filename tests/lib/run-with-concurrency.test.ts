import { describe, expect, it } from "vitest";

import { runWithConcurrency } from "@/lib/async/run-with-concurrency";

describe("runWithConcurrency", () => {
  it("preserves task order while limiting active work", async () => {
    let active = 0;
    let maximumActive = 0;
    const tasks = Array.from({ length: 12 }, (_, index) => async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    });

    const results = await runWithConcurrency(tasks, 4);

    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(maximumActive).toBe(4);
  });

  it("rejects invalid concurrency", async () => {
    await expect(runWithConcurrency([async () => "unused"], 0)).rejects.toThrow("positive integer");
  });
});
