import { ChildProcess, spawn as systemSpawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserExecutable, openConsentBrowser } from "../../integrations/mcp/browser.mts";

const url="https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1/oauth/authorize?state=fixture&code_challenge=fixture";
function fixture() {
  const child=new ChildProcess();
  vi.spyOn(child,"kill").mockReturnValue(true);
  const spawn=vi.fn().mockReturnValue(child);
  return {child,spawn,options:{windowsRoot:"C:\\Windows",spawn:spawn as unknown as typeof systemSpawn}};
}
afterEach(()=>vi.useRealTimers());
describe("packaged browser consent",()=>{
  it("uses an absolute system executable and passes the URL as data",async()=>{
    const f=fixture();const task=openConsentBrowser(url,f.options);
    f.child.emit("exit",0);await task;
    const [binary,args,options]=f.spawn.mock.calls[0];
    expect(binary).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args.join(" ")).not.toContain(url);
    expect(args.join(" ")).toContain("-WindowStyle Normal");
    expect(options).toMatchObject({windowsHide:true,stdio:"ignore",env:{TRADE_OS_AUTHORIZATION_URL:url}});
  });
  it.each(["ENOENT","EACCES"])("reports %s immediately for GUI guidance",async code=>{
    const f=fixture();const task=openConsentBrowser(url,f.options);
    f.child.emit("error",Object.assign(new Error("private system detail"),{code}));
    await expect(task).rejects.toMatchObject({code:"BROWSER_UNAVAILABLE"});
  });
  it("rejects failed shell exit",async()=>{
    const f=fixture();const task=openConsentBrowser(url,f.options);
    f.child.emit("exit",1);await expect(task).rejects.toMatchObject({code:"BROWSER_UNAVAILABLE"});
  });
  it("bounds a stalled launcher and terminates only its child",async()=>{
    vi.useFakeTimers();const f=fixture();const task=openConsentBrowser(url,f.options);
    const rejected=expect(task).rejects.toMatchObject({code:"BROWSER_UNAVAILABLE"});
    await vi.advanceTimersByTimeAsync(10000);await rejected;expect(f.child.kill).toHaveBeenCalledOnce();
  });
  it.each([undefined,"powershell.exe","C:\\Windows\\..\\Other","\\\\server\\share"])("rejects unsafe OS root %s",root=>{
    if(root===undefined){vi.stubEnv("SystemRoot","");}
    try {expect(()=>browserExecutable(root)).toThrow("BROWSER_UNAVAILABLE");}finally{vi.unstubAllEnvs();}
  });
  it.each(["file:///C:/app.exe","http://localhost/consent","https://user:password@example.com/","https://example.com/#private"])("rejects invalid browser URL %s",async value=>{
    const f=fixture();await expect(openConsentBrowser(value,f.options)).rejects.toMatchObject({code:"BROWSER_UNAVAILABLE"});expect(f.spawn).not.toHaveBeenCalled();
  });
});
