import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { signOut } from "@/app/(app)/actions";

describe("normal browser sign-out", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({ auth: { signOut: mocks.signOut } });
    mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });

  it("ends only the cookie-backed session, not separately consented integrations", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login");
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
  });
});
