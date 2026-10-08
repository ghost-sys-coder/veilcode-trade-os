import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ claims: vi.fn(), redirect: vi.fn(), session: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: auth.claims, getSession: auth.session }, from: auth.from,
}) }));
vi.mock("next/navigation", () => ({ redirect: auth.redirect }));
import { requireUserId } from "@/lib/auth";

beforeEach(() => {
  vi.resetAllMocks();
  auth.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT_TO_LOGIN"); });
});

describe("existing browser sign-in guard", () => {
  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: "owner" } }, error: { code: "JWT_EXPIRED" } },
  ])("redirects missing or rejected verified claims before any data read", async response => {
    auth.claims.mockResolvedValue(response);
    await expect(requireUserId()).rejects.toThrow("NEXT_REDIRECT_TO_LOGIN");
    expect(auth.redirect).toHaveBeenCalledWith("/login");
    expect(auth.from).not.toHaveBeenCalled();
    expect(auth.session).not.toHaveBeenCalled();
  });

  it("returns the verified subject without trusting a raw session", async () => {
    auth.claims.mockResolvedValue({ data: { claims: { sub: "owner" } }, error: null });
    await expect(requireUserId()).resolves.toBe("owner");
    expect(auth.redirect).not.toHaveBeenCalled();
    expect(auth.session).not.toHaveBeenCalled();
    expect(auth.from).not.toHaveBeenCalled();
  });

  it("fails closed on an unexpected verification failure", async () => {
    const unavailable = new Error("AUTH_VERIFICATION_UNAVAILABLE");
    auth.claims.mockRejectedValue(unavailable);
    await expect(requireUserId()).rejects.toBe(unavailable);
    expect(auth.session).not.toHaveBeenCalled();
    expect(auth.from).not.toHaveBeenCalled();
  });
});
