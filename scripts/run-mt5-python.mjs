import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..",import.meta.url));
const source = fileURLToPath(new URL("../integrations/mt5",import.meta.url));
const tools = fileURLToPath(new URL("../.artifacts/python-tools",import.meta.url));
const environment = { ...process.env,PYTHONPATH: [source,tools,process.env.PYTHONPATH].filter(Boolean).join(delimiter) };
const commands = process.argv.includes("--check")
  ? [["-m","ruff","check","integrations/mt5"],["-m","compileall","-q","integrations/mt5"]]
  : [["-m","unittest","discover","-s","integrations/mt5/tests","-v"]];
for (const args of commands) {
  const result = spawnSync("python",args,{ cwd: root,env: environment,stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error("Python verification failed. Install the documented local development tools if missing.");
    process.exitCode = result.status || 1;
    break;
  }
}
