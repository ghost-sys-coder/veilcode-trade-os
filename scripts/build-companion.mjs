import { readFile, readdir, mkdir, cp, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, delimiter, dirname, basename, sep } from "node:path";
import ts from "typescript";

const project = fileURLToPath(new URL("..", import.meta.url));
const inputs = JSON.parse(await readFile(join(project, "integrations/companion/runtime-inputs.json"), "utf8"));
if (process.platform !== "win32" || inputs.platform !== "win-x64") throw Error("Windows x64 build required");
const base = join(project, ".artifacts", "companion");
const stage = join(base, `build-${Date.now()}`);
await mkdir(stage, { recursive: false }); // Never delete or overwrite another build.
const environment = { ...process.env, PYTHONPATH: [join(project, "integrations/companion"), join(project, "integrations/mt5")].join(delimiter) };
function python(args) {
  // Cold DLL/antivirus I/O can exceed one minute on a memory-constrained builder.
  // This bounds offline build work only; application/collector/test deadlines do not change.
  return execFileSync("python", ["-m", "trade_os_companion.build", ...args], { cwd: project, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
}
async function verifiedArchive(input) {
  const path = join(base, "downloads", basename(new URL(input.url).pathname));
  if ((await lstat(path)).isSymbolicLink() || createHash("sha256").update(await readFile(path)).digest("hex") !== input.sha256) throw Error("Runtime archive failed verification");
  return path;
}
python(["extract", "--path", await verifiedArchive(inputs.node), "--destination", join(stage, "runtime/node"), "--prefix", `node-v${inputs.node.version}-win-x64`, "--selected", "node.exe", "LICENSE"]);
python(["extract", "--path", await verifiedArchive(inputs.python), "--destination", join(stage, "runtime/python")]);
console.log("Verified runtimes extracted into isolated build");
const libraries = join(stage, "runtime/python/Lib/site-packages"); await mkdir(libraries, { recursive: true });
for (const wheel of inputs.wheels) {
  const location = join(stage, `wheel-${wheel.name}`);
  python(["extract", "--path", await verifiedArchive(wheel), "--destination", location]);
  for (const name of await readdir(location)) await cp(join(location, name), join(libraries, name), {
    recursive: true, errorOnExist: true, force: false,
    filter: path => !relative(location, path).split(sep).some(part => ["tests", "benchmarks", "__pycache__"].includes(part))
  });
  // Intermediate wheel folders are outside the final distribution inventory.
}
await writeFile(join(stage, "runtime/python/python313._pth"), "python313.zip\n.\nLib/site-packages\n../../integrations/mt5\n../../integrations/companion\n", "utf8");
await cp(join(project, "integrations/mt5/trade_os_mt5"), join(stage, "integrations/mt5/trade_os_mt5"), {
  recursive: true, filter: path => !path.includes("__pycache__") && !path.endsWith(".pyc") });
await cp(join(project, "integrations/companion/trade_os_companion"), join(stage, "integrations/companion/trade_os_companion"), {
  recursive: true, filter: path => !path.includes("__pycache__") && !path.endsWith(".pyc") && !path.endsWith("build.py") });
await mkdir(join(stage, "integrations/mcp"), { recursive: true });
await cp(join(project, "integrations/mcp/vault.py"), join(stage, "integrations/mcp/vault.py"));
function importsToMjs(context) {
  const factory = context.factory;
  const visitor = node => {
    if (ts.isStringLiteral(node) && /\.(mts|ts)$/.test(node.text) && node.text.startsWith("."))
      return factory.createStringLiteral(node.text.replace(/\.(mts|ts)$/, ".mjs"));
    return ts.visitEachChild(node, visitor, context);
  };
  return node => ts.visitNode(node, visitor);
}
const modules = (await readdir(join(project, "integrations/mcp"))).filter(name => name.endsWith(".mts")).map(name => `integrations/mcp/${name}`);
modules.push("domain/integrations/local-mcp-config.ts");
modules.push("services/integrations/verify-token.ts", "domain/integrations/actor.ts");
for (const name of modules) {
  const source = await readFile(join(project, name), "utf8");
  const result = ts.transpileModule(source, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, transformers: { before: [importsToMjs] }, reportDiagnostics: true });
  if (result.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error)) throw Error("Adapter compilation failed");
  const target = join(stage, name.replace(/\.(mts|ts)$/, ".mjs")); await mkdir(dirname(target), { recursive: true }); await writeFile(target, result.outputText);
}
// Only the installed SDK dependency closure, not Next/React, env files or artifacts.
const visited = new Set();
async function dependency(name, caller = join(project, "node_modules")) {
  if (!/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) throw Error("Invalid dependency inventory");
  let location = join(caller, name);
  try { await lstat(location); } catch { location = join(project, "node_modules", name); }
  const key = relative(join(project, "node_modules"), location);
  if (key.startsWith("..")) throw Error("Dependency resolves outside installed inventory");
  if (visited.has(key)) return;
  const metadata = JSON.parse(await readFile(join(location, "package.json"), "utf8"));
  if (metadata.name !== name || (await lstat(location)).isSymbolicLink()) throw Error("Unexpected dependency source");
  visited.add(key);
  await cp(location, join(stage, "node_modules", key), { recursive: true, filter: path => {
    const within = relative(location, path).split(sep);
    if (within.includes("node_modules")) return false;
    if (within.some(part => part === ".npmrc" || part.startsWith(".env") || part.endsWith(".pem"))) throw Error("Private file in dependency inventory");
    if (within.some(part => ["src", "tests", "test", "examples", "__tests__"].includes(part))) return false;
    if (/\.(?:[cm]?ts|map)$/.test(path)) return false;
    return true;
  } });
  for (const child of Object.keys(metadata.dependencies ?? {})) await dependency(child, join(location, "node_modules"));
}
for (const name of ["@modelcontextprotocol/client", "@modelcontextprotocol/server", "jose", "zod"]) await dependency(name);
console.log(`Compiled adapter and copied ${visited.size} runtime dependencies`);
const compiler = join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
const source = join(project, "integrations/companion/native/Companion.cs");
for (const [filename, target, entry] of [["TradeOS.exe", "winexe", "Program"], ["TradeOSMcp.exe", "exe", "McpProgram"]]) {
  execFileSync(compiler, ["/nologo", "/platform:x64", `/target:${target}`, `/main:TradeOS.Companion.${entry}`, `/out:${join(stage, filename)}`,
    "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll",
    `/win32manifest:${join(project, "integrations/companion/native/app.manifest")}`, source,
    join(project, "integrations/companion/native/Compatibility.cs"), join(project, "integrations/companion/native/NativeTheme.cs")], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
}
// Wheel extraction scratch is excluded from the final package; no user files involved.
const files = JSON.parse(python(["inventory", "--path", stage, "--exclude", ...inputs.wheels.map(row => `wheel-${row.name}`)]));
console.log(`Native executables compiled; ${files.length} packaged files hashed`);
const manifest = { version: 1, releaseState: "UNRELEASED", platform: "win-x64", inputs, files };
await writeFile(join(stage, "bundle-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const packagedNode = execFileSync(join(stage, "runtime/node/node.exe"), ["--version"], { encoding: "utf8" }).trim();
const packagedPython = execFileSync(join(stage, "runtime/python/python.exe"), ["-B", "-I", "-c", "import sys,sqlite3,ssl,MetaTrader5,numpy,trade_os_companion.cli;print(sys.version.split()[0])"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
if (packagedNode !== `v${inputs.node.version}` || packagedPython !== inputs.python.version) throw Error("Bundled runtime smoke check failed");
const payload = join(base, `${basename(stage)}.zip`);
python(["pack", "--path", stage, "--destination", payload]);
const installer = join(base, `${basename(stage)}-setup.exe`);
execFileSync(compiler, ["/nologo", "/platform:x64", "/target:winexe", "/main:TradeOS.Companion.InstallerProgram", `/out:${installer}`,
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", "/r:System.IO.Compression.dll",
  `/win32manifest:${join(project, "integrations/companion/native/app.manifest")}`, `/resource:${payload},TradeOS.Payload`,
  join(project, "integrations/companion/native/Installer.cs"),
  join(project, "integrations/companion/native/NativeTheme.cs"),
  join(project, "integrations/companion/native/Compatibility.cs")], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
const result = { stage: resolve(stage), installer, state: "UNRELEASED", node: packagedNode, python: packagedPython, files: files.length, dependencies: visited.size };
await writeFile(join(base, "latest-build.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
