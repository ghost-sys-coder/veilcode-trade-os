import { describe, expect, it, vi, afterEach } from "vitest";
const { read, download, create } = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn(), create: vi.fn() }));
vi.mock("@/services/integrations/setup-profiles", () => ({ readSetupState: read, downloadSetupConfiguration: download }));
vi.mock("@/lib/supabase/server", () => ({ createClient: create }));
import { GET } from "@/app/api/integrations/setup/[profileId]/desktop-extension/route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
function fixture() {
  for (const [name, value] of Object.entries({ TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED: "true",
    TRADE_OS_COMPANION_PREVIEW_TAG: "companion-preview-20261013-abcdef0", TRADE_OS_COMPANION_PREVIEW_SHA256: "a".repeat(64),
    TRADE_OS_COMPANION_PREVIEW_BYTES: "59000000", TRADE_OS_CLAUDE_DESKTOP_PREVIEW_TAG: "companion-preview-20261013-abcdef0",
    TRADE_OS_CLAUDE_DESKTOP_PREVIEW_SHA256: "b".repeat(64), TRADE_OS_CLAUDE_DESKTOP_PREVIEW_BYTES: "12000" })) vi.stubEnv(name, value);
  read.mockResolvedValue({ desktopEnabled: true, profiles: [{ id, clientKind: "CLAUDE_DESKTOP" }] });
  download.mockResolvedValue({ configuration: {} }); create.mockResolvedValue({});
}
const invoke = (profileId = id) => GET(new Request("https://app.example/download"), { params: Promise.resolve({ profileId }) });
describe("owned Desktop extension download", () => {
  it("rechecks public setup and returns an uncached fixed-release redirect", async () => {
    fixture(); const result = await invoke();
    expect(result.status).toBe(302); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("location")).toBe("https://github.com/ghost-sys-coder/veilcode-trade-os/releases/download/companion-preview-20261013-abcdef0/TradeOS-Claude-Desktop-Windows.mcpb");
    expect(download).toHaveBeenCalledExactlyOnceWith({}, id);
  });
  it("denies another owner/profile before returning any release location", async () => {
    fixture(); const result = await invoke("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result.status).toBe(403); expect(result.headers.get("location")).toBeNull(); expect(download).not.toHaveBeenCalled();
  });
  it("rejects a Claude Code profile", async () => {
    fixture(); read.mockResolvedValue({ desktopEnabled: true, profiles: [{ id, clientKind: "CLAUDE_CODE" }] });
    expect((await invoke()).status).toBe(403); expect(download).not.toHaveBeenCalled();
  });
  it("rejects disabled database onboarding", async () => {
    fixture(); read.mockResolvedValue({ desktopEnabled: false, profiles: [{ id, clientKind: "CLAUDE_DESKTOP" }] });
    expect((await invoke()).status).toBe(403);
  });
  it("rejects stale provider binding without leaking its failure", async () => {
    fixture(); download.mockRejectedValue(Error("private provider response")); const result = await invoke();
    expect(result.status).toBe(403); expect(await result.text()).not.toContain("private provider");
  });
  it("disabled release never queries user data", async () => {
    fixture(); vi.stubEnv("TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED", "false");
    expect((await invoke()).status).toBe(403); expect(create).not.toHaveBeenCalled();
  });
});
