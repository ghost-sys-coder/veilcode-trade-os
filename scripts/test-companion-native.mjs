import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, copyFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
const project = fileURLToPath(new URL("..", import.meta.url));
const index = JSON.parse(await readFile(join(project, ".artifacts/companion/latest-build.json"), "utf8"));
const root = dirname(index.stage), stage = index.stage;
if (!stage.startsWith(join(project, ".artifacts/companion/build-")) || index.state !== "UNRELEASED") throw Error("Exact unreleased local bundle required");
const tests = join(root, "native-tests"); await mkdir(tests, { recursive: true });
await copyFile(join(project, "integrations/companion/tests/packaged-runtime.mjs"), join(tests, "packaged-runtime.mjs"));
await mkdir(join(root, "fixtures"), { recursive: true });
const executable = join(tests, "NativeTests.exe");
const compiler = join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
execFileSync(compiler, ["/nologo", "/debug", "/platform:x64", "/target:exe", "/main:TradeOS.Companion.NativeTests", "/out:" + executable,
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Web.Extensions.dll", "/r:System.IO.Compression.dll",
  "/win32manifest:" + join(project, "integrations/companion/native/app.manifest"),
  ...["Companion.cs", "Installer.cs", "NativeTests.cs", "Compatibility.cs"].map(name => join(project, "integrations/companion/native", name))], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
execFileSync(executable, [join(root, basename(stage) + ".zip"), join(root, "fixtures", randomUUID())], { stdio: "inherit", timeout: 60000, windowsHide: true });
