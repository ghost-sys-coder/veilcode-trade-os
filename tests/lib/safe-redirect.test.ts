import { describe, expect, it } from "vitest";

import { safeInternalRedirect, safePostAuthRedirect } from "@/lib/safe-redirect";

describe("safeInternalRedirect", () => {
  it("preserves internal paths with queries", () => {
    expect(safeInternalRedirect("/trades/new?from=position-calculator")).toBe("/trades/new?from=position-calculator");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(safeInternalRedirect("https://example.com/steal")).toBe("/dashboard");
    expect(safeInternalRedirect("//example.com/steal")).toBe("/dashboard");
    expect(safeInternalRedirect("/\\example.com")).toBe("/dashboard");
  });

  it("prevents authenticated redirects back into authentication routes", () => {
    expect(safePostAuthRedirect("/login")).toBe("/dashboard");
    expect(safePostAuthRedirect("/login?next=/login")).toBe("/dashboard");
    expect(safePostAuthRedirect("/auth/callback?code=example")).toBe("/dashboard");
    expect(safePostAuthRedirect("/trades/new?from=position-calculator")).toBe("/trades/new?from=position-calculator");
  });
});
