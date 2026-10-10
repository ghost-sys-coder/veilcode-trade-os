import { spawn } from "node:child_process";
import { readConfig, LocalMcpError, safeMessage } from "./config.mts";
import { WindowsVault } from "./vault.mts";
import { LocalAuthorization } from "./auth.mts";
import { connectRemote, startStdio } from "./proxy.mts";

// Launch with node directly, never npm (npm banners corrupt protocol stdout).
let vault: WindowsVault | undefined;
try {
  const [command, flag, path, ...extra]=process.argv.slice(2);
  if(!["login","run","status","refresh","disconnect"].includes(command)||flag!=="--config"||!path||extra.length)
    throw new LocalMcpError("INVALID_CONFIG");
  const config=await readConfig(path);
  vault=new WindowsVault(config);
  const auth=new LocalAuthorization(config,vault);
  if(command==="disconnect") {
    await vault.clear(); process.stderr.write("Local credentials cleared. Revoke application access in Settings > Integrations separately.\n");
  } else {
    if(command==="login") await auth.login(async url=>{
      process.stderr.write("Opening Trade OS browser consent. If no window appears, open this authorization URL in your browser:\n"+url+"\n");
      await new Promise<void>(resolve=>{
        const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command","Start-Process -FilePath $env:TRADE_OS_AUTHORIZATION_URL -WindowStyle Hidden"],
          {windowsHide:true,stdio:"ignore",env:{...process.env,TRADE_OS_AUTHORIZATION_URL:url}});
        let finished=false;
        const finish=(opened:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);
          if(!opened)process.stderr.write("Trade OS MCP: Browser launch unavailable. Open the authorization URL above within three minutes.\n");
          resolve();};
        const timer=setTimeout(()=>{child.kill();finish(false);},10000);
        child.once("error",()=>finish(false));child.once("exit",code=>finish(code===0));
      });
    });
    else {await auth.discovery();await auth.load();}
    if(command==="refresh") await auth.refresh();
    const remote=await connectRemote(config,auth);
    if(command==="run") {
      const ownedVault=vault;startStdio(remote,()=>void ownedVault.close());vault=undefined;
    } else {
      await remote.close();process.stderr.write("Trade OS MCP connection verified. Credentials are Windows-protected; no MT5 terminal is required.\n");
    }
  }
} catch(error) {process.stderr.write(safeMessage(error)+"\n");process.exitCode=1;}
finally {await vault?.close();}
