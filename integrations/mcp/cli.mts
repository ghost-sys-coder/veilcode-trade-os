import { readConfig, LocalMcpError, safeMessage } from "./config.mts";
import { openConsentBrowser } from "./browser.mts";
import { WindowsVault } from "./vault.mts";
import { LocalAuthorization } from "./auth.mts";
import { connectRemote, startStdio } from "./proxy.mts";

// Launch with node directly, never npm (npm banners corrupt protocol stdout).
let vault: WindowsVault | undefined;
try {
  const [command, flag, path, ...extra]=process.argv.slice(2);
  const gui=extra.length===1&&extra[0]==="--gui"&&["login","status"].includes(command);
  if(!["login","run","status","refresh","disconnect"].includes(command)||flag!=="--config"||!path||(extra.length&&!gui))
    throw new LocalMcpError("INVALID_CONFIG");
  const config=await readConfig(path);
  vault=new WindowsVault(config);
  const auth=new LocalAuthorization(config,vault);
  if(command==="disconnect") {
    await vault.clear(); process.stderr.write("Local credentials cleared. Revoke application access in Settings > Integrations separately.\n");
  } else {
    if(command==="login") await auth.login(async url=>{
      process.stderr.write("Opening Trade OS browser consent. If no window appears, open this authorization URL in your browser:\n"+url+"\n");
      try {await openConsentBrowser(url);}
      catch(error) {
        if(gui)throw error;
        process.stderr.write("Trade OS MCP: Browser launch unavailable. Open the authorization URL above within three minutes.\n");
      }
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
} catch(error) {
  const allowed=["INVALID_CONFIG","LOGIN_REQUIRED","ACCESS_DENIED","PROFILE_BUSY","VAULT_UNAVAILABLE","INVALID_DISCOVERY","LOGIN_TIMEOUT","REFRESH_UNCERTAIN","BROWSER_UNAVAILABLE"];
  const code=error instanceof LocalMcpError&&allowed.includes(error.code)?error.code:"UNAVAILABLE";
  process.stderr.write("TRADE_OS_MCP_ERROR:"+code+"\n"+safeMessage(error)+"\n");process.exitCode=1;
}
finally {await vault?.close();}
