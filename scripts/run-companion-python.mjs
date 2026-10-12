import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const environment = { ...process.env, PYTHONPATH: ["integrations/companion", "integrations/mt5", ".artifacts/python-tools"].join(delimiter) };
const commands = process.argv.includes("--check")
  ? [["-m", "ruff", "check", "--config", "integrations/mt5/pyproject.toml", "integrations/companion"], ["-m", "compileall", "-q", "integrations/companion"]]
  : [["-m", "unittest", "discover", "-s", "integrations/companion/tests", "-v"]];
for (const args of commands) {
  const result = spawnSync("python", args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error || result.status !== 0) { process.exitCode = result.status || 1; break; }
}
