import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProfileSettings } from "@/features/settings/actions";
import { ApplicationWorkflowError } from "@/services/application/transaction";
const { write, verified, revalidate, client, requireUser } = vi.hoisted(() => ({ write: vi.fn(), verified: vi.fn(), revalidate: vi.fn(), client: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/services/application/profile", () => ({ patchProfile: write }));
vi.mock("@/services/integrations/browser-context", () => ({ getVerifiedBrowserContext: verified }));
vi.mock("@/lib/supabase/server", () => ({ createClient: client }));
vi.mock("@/lib/auth", () => ({ requireUserId: requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
vi.mock("@/lib/action-errors", () => ({ firstValidationError: () => "Invalid preferences", redirectWithStatus: (path: string, status: string, message: string) => { throw new Error(`${path}:${status}:${message}`); } }));
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
afterEach(() => vi.resetAllMocks());
function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ operationId, expectedVersion: "1", ...values })) data.set(key, value);
  client.mockResolvedValue({}); requireUser.mockResolvedValue(operationId); verified.mockResolvedValue({ userId: operationId }); write.mockResolvedValue({});
  return data;
}
describe("browser profile adapter", () => {
  it("shares the writer, normalizes timezone and clears a deliberate empty name", async () => {
    await expect(saveProfileSettings(form({ displayName: " ", timezone: " utc " }))).rejects.toThrow("Workspace settings updated.");
    expect(write).toHaveBeenCalledWith({ userId: operationId }, { operationId, expectedVersion: "1", values: { displayName: null, timezone: "UTC" } });
    expect(revalidate).toHaveBeenCalledWith("/analytics", "layout"); expect(revalidate).toHaveBeenCalledWith("/calendar");
  });
  it("does not silently clear an omitted name", async () => {
    await expect(saveProfileSettings(form({ timezone: "UTC" }))).rejects.toThrow("Workspace settings updated.");
    expect(write.mock.calls[0][1].values).toEqual({ timezone: "UTC" });
  });
  it("rejects missing operation/version before a write", async () => {
    const data = form({ displayName: "Trader" }); data.delete("operationId");
    await expect(saveProfileSettings(data)).rejects.toThrow("Invalid preferences"); expect(write).not.toHaveBeenCalled();
  });
  it("rejects a File instead of treating it as a name", async () => {
    const data = form({ timezone: "UTC" }); data.set("displayName", new File(["fixture"], "name.txt"));
    await expect(saveProfileSettings(data)).rejects.toThrow("Invalid preferences"); expect(write).not.toHaveBeenCalled();
  });
  it("reports stale versions without revalidation or a direct-table fallback", async () => {
    const data = form({ displayName: "Trader" }); write.mockRejectedValue(new ApplicationWorkflowError("VERSION_CONFLICT"));
    await expect(saveProfileSettings(data)).rejects.toThrow("This record changed"); expect(write).toHaveBeenCalledOnce(); expect(revalidate).not.toHaveBeenCalled();
  });
  it("does not leak unexpected private failures", async () => {
    const data = form({ displayName: "Trader" }); write.mockRejectedValue(new Error("PRIVATE_TEST_VALUE"));
    await expect(saveProfileSettings(data)).rejects.toThrow("Invalid preferences or unavailable profile"); expect(revalidate).not.toHaveBeenCalled();
  });
});
