// Native test assembly executes this with bundled Node, cwd = installed fixture.
// This file is NOT shipped, and never opens a browser or accesses a real grant.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { configSchema, vaultId, LocalMcpError } from "./integrations/mcp/config.mjs";
import { WindowsVault } from "./integrations/mcp/vault.mjs";
import { LocalAuthorization } from "./integrations/mcp/auth.mjs";
import { startStdio } from "./integrations/mcp/proxy.mjs";
import { browserExecutable } from "./integrations/mcp/browser.mjs";
import { spawnSync } from "node:child_process";

// Actual system PowerShell, with the GUI's restricted PATH. No browser, network
// or provider consent: prove the packaged launcher can resolve its fixed binary.
const shell = spawnSync(browserExecutable(), ["-NoProfile", "-NonInteractive", "-Command", "exit 0"],
  { windowsHide: true, stdio: "ignore", timeout: 10000 });
assert.equal(shell.status, 0, "PowerShell launches by absolute OS path under the restricted companion environment");

const config = configSchema.parse({
  version: 1, profile: "tradeos-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  resource: "https://mcp-preview.veilcode.studio/mcp",
  issuer: "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1",
  clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  redirectUri: "http://127.0.0.1:9878/callback", allowLoopback: false,
});
const input = { operationId: "unchanged-fixture", net_pnl: "0.01", clear: null };
const remote = {
  listTools: async (_, options) => {
    assert.equal(options.cacheMode, "refresh");
    return {tools: [{name: "fixture_write", inputSchema: {type: "object"}}]};
  },
  callTool: async request => {
    assert.deepEqual(request.arguments, input);
    return {content: [{type: "text", text: "fixture"}], structuredContent: {net_pnl: "0.01", clear: null}};
  },
  listResources: async request => {
    assert.equal(request.cursor, "PAGE_1");
    return {resources: [], nextCursor: "PAGE_2"};
  },
  readResource: async (_, options) => {
    assert.equal(options.cacheMode, "bypass");
    return {contents: [{uri: "tradeos://fixture", text: "{}"}]};
  },
  listResourceTemplates: async () => ({resourceTemplates: []}),
  close: async () => {},
};

if (process.argv[2] === "--server") {
  startStdio(remote, () => {});
} else {
  let vault;
  try {
  vault = new WindowsVault(config);
  const payload = { disconnected: true, testMarker: "NO_REAL_CREDENTIALS_NATIVE_FIXTURE" };
  await vault.save(payload);
  const encrypted = await readFile(join(process.env.LOCALAPPDATA, "TradeOS", "credentials", vaultId(config) + ".dpapi"));
  assert(!encrypted.includes(Buffer.from(payload.testMarker)));
  assert.deepEqual(await vault.load(), payload);
  const competing = new WindowsVault(config);
  try { await assert.rejects(competing.load(), error => error instanceof LocalMcpError && error.code === "PROFILE_BUSY"); }
  finally { await competing.close(); }
  await vault.close(); vault = new WindowsVault(config);
  assert.deepEqual(await vault.load(), payload);
  const auth = new LocalAuthorization(config, vault, {
    fetch: async () => { throw Error("NETWORK_FORBIDDEN"); },
  });
  await assert.rejects(auth.load(), error => error instanceof LocalMcpError && error.code === "LOGIN_REQUIRED");
  } finally { await vault?.close(); }

  for (const mode of ["legacy", {pin: "2026-07-28"}]) {
  const client = new Client({name: "packaged-native-fixture", version: "1"}, {versionNegotiation: {mode}});
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(import.meta.url), "--server"],
    cwd: process.cwd(), env: process.env, stderr: "pipe",
  });
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 1);
    assert.deepEqual((await client.callTool({name: "fixture_write", arguments: input})).structuredContent, {net_pnl: "0.01", clear: null});
    assert.equal((await client.listResources({cursor: "PAGE_1"})).nextCursor, "PAGE_2");
    assert.equal((await client.readResource({uri: "tradeos://fixture"})).contents.length, 1);
    assert.equal((await client.listResourceTemplates()).resourceTemplates.length, 0);
  } finally { await client.close(); await transport.close(); }
  }
  process.stdout.write("PACKAGED_RUNTIME_VERIFIED\n");
}
