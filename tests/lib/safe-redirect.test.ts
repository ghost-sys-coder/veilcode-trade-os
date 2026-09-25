import { describe, expect, it } from "vitest";

import { safeInternalRedirect } from "@/lib/safe-redirect";

describe("safeInternalRedirect", () => {
  it("preserves internal paths with queries", () => {
    expect(safeInternalRedirect("/trades/new?from=position-calculator")).toBe("/trades/new?from=position-calculator");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(safeInternalRedirect("https://example.com/steal")).toBe("/dashboard");
    expect(safeInternalRedirect("//example.com/steal")).toBe("/dashboard");
    expect(safeInternalRedirect("/\\example.com")).toBe("/dashboard");
  });
});
