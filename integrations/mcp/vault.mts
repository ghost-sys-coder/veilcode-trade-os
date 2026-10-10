import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { credentialContext, LocalMcpError, vaultId, type LocalMcpConfig } from "./config.mts";

export interface CredentialStore {
  load(): Promise<unknown>;
  save(payload: unknown): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}
/** Python is an OS-protection shim only. No broker package/import or network. */
export class WindowsVault implements CredentialStore {
  private child: ChildProcessWithoutNullStreams;
  private pending?: { resolve(value: Record<string,unknown>): void; reject(error: unknown): void };
  private buffer = "";
  private ready: Promise<Record<string,unknown>>;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(config: LocalMcpConfig) {
    this.child = spawn("python", ["-I", "-u", fileURLToPath(new URL("./vault.py", import.meta.url))], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.resume(); // Never propagate raw traceback or credential IPC.
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => this.fail());
    this.child.stdin.on("error", () => this.fail());
    this.child.stdout.on("data", (data: string) => {
      this.buffer += data;
      if (this.buffer.length > 180000) return this.fail();
      let end: number;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0,end); this.buffer = this.buffer.slice(end+1);
        try {
          const value = JSON.parse(line) as Record<string,unknown>;
          const pending = this.pending; this.pending = undefined;
          if (!pending) return this.fail();
          if (value.error) pending.reject(new LocalMcpError(value.error === "PROFILE_BUSY" ? "PROFILE_BUSY" : "VAULT_UNAVAILABLE"));
          else pending.resolve(value);
        } catch { this.fail(); }
      }
    });
    this.ready = this.send({id: vaultId(config), context: credentialContext(config)});
    // Startup can fail before the first operation; retain a handled promise.
    void this.ready.catch(() => {});
  }
  private fail() {
    this.closed = true;
    this.pending?.reject(new LocalMcpError("VAULT_UNAVAILABLE")); this.pending = undefined;
    this.child.kill();
  }
  private async send(value: unknown): Promise<Record<string,unknown>> {
    if (this.closed || this.pending) throw new LocalMcpError("VAULT_UNAVAILABLE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Record<string,unknown>>((resolve,reject) => {
        this.pending = {resolve,reject};
        timer = setTimeout(() => this.fail(),10000);
        this.child.stdin.write(JSON.stringify(value)+"\n");
      });
    } finally { clearTimeout(timer); }
  }
  private command(value: unknown): Promise<Record<string,unknown>> {
    const next = this.chain.then(async () => {await this.ready; return this.send(value);});
    this.chain = next.catch(() => {}); return next;
  }
  async load(): Promise<unknown> { return (await this.command({action:"load"})).payload; }
  async save(payload: unknown) { await this.command({action:"save",payload}); }
  async clear() { await this.command({action:"clear"}); }
  async close() {
    this.closed = true;
    this.pending?.reject(new LocalMcpError("VAULT_UNAVAILABLE"));this.pending=undefined;
    if(this.child.exitCode!==null || this.child.signalCode!==null)return;
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{this.child.kill();resolve();},2000);
      this.child.once("exit",()=>{clearTimeout(timer);resolve();});this.child.stdin.end();
    });
  }
}
