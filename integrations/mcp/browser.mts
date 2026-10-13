import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { LocalMcpError } from "./config.mts";

/** The packaged companion deliberately excludes PowerShell from PATH. */
export function browserExecutable(windowsRoot = process.env.SystemRoot): string {
  if (!windowsRoot || !/^[A-Za-z]:\\/.test(windowsRoot) || win32.normalize(windowsRoot) !== windowsRoot
    || /[\r\n\0]/.test(windowsRoot)) throw new LocalMcpError("BROWSER_UNAVAILABLE");
  return win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export async function openConsentBrowser(url: string, options: { windowsRoot?: string; spawn?: typeof spawn } = {}) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || target.hash || target.href !== url)
    throw new LocalMcpError("BROWSER_UNAVAILABLE");
  const executable = browserExecutable(options.windowsRoot);
  await new Promise<void>((resolve, reject) => {
    const child = (options.spawn ?? spawn)(executable,
      ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:TRADE_OS_AUTHORIZATION_URL -WindowStyle Normal"],
      { windowsHide: true, stdio: "ignore", env: { ...process.env, TRADE_OS_AUTHORIZATION_URL: url } });
    let finished = false;
    const finish = (opened: boolean) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (opened) resolve(); else reject(new LocalMcpError("BROWSER_UNAVAILABLE"));
    };
    const timer = setTimeout(() => { child.kill(); finish(false); }, 10000);
    child.once("error", () => finish(false));
    child.once("exit", code => finish(code === 0));
  });
}
