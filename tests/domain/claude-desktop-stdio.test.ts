import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const context = vi.hoisted(() => ({ pin: "", pinPath: "", spawn: vi.fn(), fsActive: 0, maxFsActive: 0 }));
vi.mock("node:child_process", () => ({ spawn: context.spawn }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual,
    lstat: async (file: string) => {
      if (file === context.pinPath) return { size: Buffer.byteLength(context.pin), isFile: () => true, isSymbolicLink: () => false };
      context.fsActive++; context.maxFsActive = Math.max(context.maxFsActive, context.fsActive);
      try { await new Promise(resolve => setImmediate(resolve)); return await actual.lstat(file); }
      finally { context.fsActive--; }
    },
    readFile: async (file: string) => file === context.pinPath ? Buffer.from(context.pin) : actual.readFile(file),
  };
});
import { launch } from "../../integrations/claude-desktop/server.mjs";

const directories: string[] = [];
afterEach(async () => {
  context.spawn.mockReset();
  context.fsActive = 0; context.maxFsActive = 0;
  vi.useRealTimers();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it.skipIf(process.platform !== "win32").each([
  {flowing:true, response:false}, {flowing:false, response:false}, {flowing:false, response:true},
])("preserves initialization and bounds startup (host: %j)", async ({flowing, response}) => {
  const directory = await mkdtemp(join(tmpdir(), "tradeos-desktop-stdio-")); directories.push(directory);
  const root = join(directory, "sealed"), data = join(directory, "data");
  await mkdir(root);
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const files = [];
  for (const name of ["TradeOS.exe", "TradeOSMcp.exe", "runtime/node/node.exe", "runtime/python/python.exe", "runtime/python/pythonw.exe"]) {
    const bytes = Buffer.from("NON_EXECUTABLE_OFFLINE_FIXTURE:" + name), file = join(root, name);
    await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, bytes);
    files.push({ path: name, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = JSON.stringify({version: 1, platform: "win-x64", files});
  await writeFile(join(root, "bundle-manifest.json"), manifest);
  context.pin = JSON.stringify({version: 1, manifestSha256: hash(manifest)});
  context.pinPath = fileURLToPath(new URL("../../integrations/claude-desktop/trusted-release.json", import.meta.url));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const config = {version: 1, profile: "tradeos-" + id, resource: "https://mcp-preview.veilcode.studio/mcp",
    issuer: "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1", clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    redirectUri: "http://127.0.0.1:9884/callback", allowLoopback: false};
  const setup = join(directory, "public.json"), imported = join(data, "TradeOS/companion/profiles", id);
  await mkdir(imported, { recursive: true });
  await writeFile(setup, JSON.stringify(config)); await writeFile(join(imported, "setup.json"), JSON.stringify(config));
  const input = new PassThrough(), child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  });
  const received: Buffer[] = [];
  child.stdin.on("data", bytes => received.push(Buffer.from(bytes)));
  context.spawn.mockReturnValue(child);
  const descriptor = Object.getOwnPropertyDescriptor(process, "stdin")!;
  const outputDescriptor = Object.getOwnPropertyDescriptor(process, "stdout")!;
  const output = new PassThrough(); const outgoing: Buffer[] = [];
  output.on("data", bytes => outgoing.push(Buffer.from(bytes)));
  const localData = process.env.LOCALAPPDATA, exitCode = process.exitCode;
  const signals = ["exit", "SIGINT", "SIGTERM"] as const;
  const processEvents: EventEmitter = process;
  const listeners = new Map(signals.map(signal => [signal, new Set(processEvents.listeners(signal))]));
  try {
    Object.defineProperty(process, "stdin", { configurable: true, value: input });
    Object.defineProperty(process, "stdout", { configurable: true, value: output });
    process.env.LOCALAPPDATA = data;
    vi.useFakeTimers({toFake:["setTimeout", "clearTimeout", "Date"]});
    if (flowing) input.resume(); // Desktop's utility host can already have its input flowing.
    const pending = launch(root, setup);
    const first = Buffer.from('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n');
    input.write(first); // Arrives before asynchronous file hashing and child spawn.
    await pending;
    await new Promise(resolve => setImmediate(resolve));
    const next = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    input.write(next);
    expect(Buffer.concat(received).equals(Buffer.concat([first, next]))).toBe(true);
    expect(context.maxFsActive).toBeGreaterThan(1);
    expect(context.maxFsActive).toBeLessThanOrEqual(4);
    expect(context.spawn).toHaveBeenCalledWith(join(root, "TradeOSMcp.exe"), ["--profile", id], expect.objectContaining({shell: false}));
    const reply = Buffer.from('{"jsonrpc":"2.0","id":0,"result":{}}\n');
    if (response) child.stdout.write(reply);
    await vi.advanceTimersByTimeAsync(45_001);
    if (response) {
      expect(child.kill).not.toHaveBeenCalled();
      expect(Buffer.concat(outgoing).equals(reply)).toBe(true);
    } else expect(child.kill).toHaveBeenCalledTimes(1);
  } finally {
    child.emit("close", 0); input.destroy(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    Object.defineProperty(process, "stdin", descriptor);
    Object.defineProperty(process, "stdout", outputDescriptor); output.destroy();
    if (localData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = localData;
    process.exitCode = exitCode;
    for (const signal of signals) for (const listener of processEvents.listeners(signal))
      if (!listeners.get(signal)!.has(listener)) processEvents.removeListener(signal, listener as (...args: unknown[]) => void);
  }
});
