import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { claudeDesktopDistribution } from "@/domain/integrations/claude-desktop-distribution";
import { desktopConfig, verifyInstallation, localPath } from "../../integrations/claude-desktop/server.mjs";
import { setupProfileSchema, mcpSetupConfiguration } from "@/domain/integrations/setup";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profile = { id, clientKind: "CLAUDE_DESKTOP", purpose: "MCP", accountId: null,
  resource: "https://mcp-preview.veilcode.studio/mcp", callbackUri: "http://127.0.0.1:9884/callback",
  clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "READY", version: "2",
  createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:01Z" };
const config = mcpSetupConfiguration(setupProfileSchema.parse(profile), "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1");
const env = { TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED: "true", TRADE_OS_COMPANION_PREVIEW_TAG: "companion-preview-20261013-abcdef0",
  TRADE_OS_COMPANION_PREVIEW_SHA256: "a".repeat(64), TRADE_OS_COMPANION_PREVIEW_BYTES: "59000000",
  TRADE_OS_CLAUDE_DESKTOP_PREVIEW_TAG: "companion-preview-20261013-abcdef0",
  TRADE_OS_CLAUDE_DESKTOP_PREVIEW_SHA256: "b".repeat(64), TRADE_OS_CLAUDE_DESKTOP_PREVIEW_BYTES: "12000" };
const dirs: string[] = [];
afterEach(async () => { for (const root of dirs.splice(0)) await rm(root, { recursive: true, force: true }); });
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
async function installation() {
  const root = await mkdtemp(join(tmpdir(), "tradeos-desktop-test-")); dirs.push(root);
  const names = ["TradeOSMcp.exe", "TradeOS.exe", "runtime/node/node.exe", "runtime/python/python.exe", "runtime/python/pythonw.exe",
    "node_modules/@modelcontextprotocol/client/fixture.mjs"];
  const files = [];
  for (const name of names) {
    const file = join(root, name), bytes = Buffer.from(`fixture:${name}`);
    await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, bytes);
    files.push({ path: name, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = JSON.stringify({ version: 1, platform: "win-x64", files });
  await writeFile(join(root, "bundle-manifest.json"), manifest);
  return { root, pin: { version: 1, manifestSha256: hash(manifest) } };
}
describe("Claude Desktop isolated onboarding and sealed release", () => {
  it("uses a separate account-free callback and public configuration", () => {
    expect(desktopConfig(config)).toEqual(config);
    expect(setupProfileSchema.safeParse({ ...profile, callbackUri: "http://127.0.0.1:9880/callback" }).success).toBe(false);
    expect(setupProfileSchema.safeParse({ ...profile, accountId: id }).success).toBe(false);
  });
  it.each([9876, 9878, 9880, 9882])("rejects another client's callback %s", port => {
    expect(() => desktopConfig({ ...config, redirectUri: `http://127.0.0.1:${port}/callback` })).toThrow();
  });
  it.each([{ resource: "https://evil.example/mcp" }, { issuer: "https://evil.example/auth/v1" },
    { resource: config.resource + "?token=x" }, { allowLoopback: true }, { accessToken: "secret" }, { profile: "../other" },
    { resource: "https://user:password@mcp-preview.veilcode.studio/mcp" }])("rejects unsafe public config %j", patch => {
    expect(() => desktopConfig({ ...config, ...patch })).toThrow();
  });
  it("publishes only fixed-repository, matched-release metadata", () => {
    expect(claudeDesktopDistribution(env)?.url).toContain("/companion-preview-20261013-abcdef0/TradeOS-Claude-Desktop-Windows.mcpb");
    expect(claudeDesktopDistribution({ ...env, TRADE_OS_CLAUDE_DESKTOP_PREVIEW_TAG: "companion-preview-20261013-aaaaaaa" })).toBeNull();
    expect(claudeDesktopDistribution({ ...env, TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED: "false" })).toBeNull();
    expect(claudeDesktopDistribution({ ...env, TRADE_OS_CLAUDE_DESKTOP_PREVIEW_SHA256: "wrong" })).toBeNull();
    expect(claudeDesktopDistribution({ ...env, TRADE_OS_CLAUDE_DESKTOP_PREVIEW_BYTES: "99999999" })).toBeNull();
  });
  it("verifies every pinned file before returning the executable", async () => {
    const { root, pin } = await installation();
    expect(await verifyInstallation(root, pin)).toBe(join(root, "TradeOSMcp.exe"));
  });
  it("rejects a self-modified manifest even if its file hash is updated", async () => {
    const { root, pin } = await installation(); await writeFile(join(root, "bundle-manifest.json"), "{}");
    await expect(verifyInstallation(root, pin)).rejects.toThrow("WRONG_COMPANION_RELEASE");
  });
  it("rejects altered dependencies as well as altered launchers", async () => {
    const { root, pin } = await installation(); await writeFile(join(root, "runtime/node/node.exe"), "changed");
    await expect(verifyInstallation(root, pin)).rejects.toThrow("MODIFIED_COMPANION");
  });
  it("rejects unlisted injected files", async () => {
    const { root, pin } = await installation(); await writeFile(join(root, "runtime/node/injected.dll"), "bad");
    await expect(verifyInstallation(root, pin)).rejects.toThrow("MODIFIED_COMPANION");
  });
  it.each(["relative/folder", "\\\\server\\share", "D:\\folder\\..\\file", "D:\\file:stream"])("rejects unsafe path %s", async value => {
    await expect(localPath(value)).rejects.toThrow();
  });
});
