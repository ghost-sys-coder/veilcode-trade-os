import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("..",import.meta.url));
const tools=fileURLToPath(new URL("../.artifacts/python-tools",import.meta.url));
const environment={...process.env,PYTHONPATH:[tools,process.env.PYTHONPATH].filter(Boolean).join(delimiter)};
const commands=process.argv.includes("--check")
  ? [["-m","ruff","check","--config","integrations/mt5/pyproject.toml","integrations/mcp"],["-m","compileall","-q","integrations/mcp"]]
  : [["-m","unittest","discover","-s","integrations/mcp/tests","-v"]];
for(const args of commands) {
  const result=spawnSync("python",args,{cwd:root,env:environment,stdio:"inherit"});
  if(result.error||result.status!==0){console.error("MCP Windows verification failed; no plaintext fallback is available.");process.exitCode=1;break;}
}
