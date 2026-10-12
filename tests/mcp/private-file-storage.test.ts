import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { privateFileStorage } from "@/services/files/storage";
import { fileDigest } from "@/services/files/content";

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server=undefined; }
});
async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  server=createServer(handler); await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
  const address=server.address(); if (!address || typeof address==="string") throw new Error("Fixture listener unavailable");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",`http://127.0.0.1:${address.port}`);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","fixture-public-key-not-a-credential");
  vi.stubEnv("SUPABASE_SECRET_KEY","fixture-local-only-server-key");
  vi.stubEnv("TRADE_OS_LOCAL_TEST_APP","true"); return privateFileStorage();
}
describe("bounded server-only Storage transport",()=>{
  it("reads authenticated full-size ranges with explicit zero-body framing",async()=>{
    const bytes=Buffer.alloc(393216,42);
    const storage=await endpoint((req,res)=>{
      expect(req.method).toBe("GET"); expect(req.headers.range).toBe("bytes=0-");
      expect(req.headers["content-length"]).toBe("0"); expect(req.url).toBe("/storage/v1/object/authenticated/trade-file-staging/owner/trade/file.part");
      res.writeHead(206,{"content-range":`bytes 0-${bytes.length-1}/${bytes.length}`,"content-length":String(bytes.length)});res.end(bytes);
    });
    const actual=await storage.get("trade-file-staging","owner/trade/file.part",bytes.length);
    expect(actual.length).toBe(bytes.length);expect(actual.equals(bytes)).toBe(true);
  });
  it.each([302,404,500])("rejects status %i without following redirects or exposing headers",async status=>{
    let calls=0;const storage=await endpoint((_,res)=>{calls++;res.writeHead(status,{location:"http://127.0.0.1/elsewhere"});res.end("secret fixture provider detail");});
    await expect(storage.get("trade-screenshots","owner/file",20)).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"}); expect(calls).toBe(1);
  });
  it.each(["bytes 1-3/4","bytes 0-2/4","bytes 0-4/5","invalid"])("rejects incomplete/oversized range %s",async range=>{
    const storage=await endpoint((_,res)=>{res.writeHead(206,{"content-range":range});res.end("abcd");});
    await expect(storage.get("trade-screenshots","owner/file",4)).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"});
  });
  it("bounds streaming responses even without Content-Length",async()=>{
    const storage=await endpoint((_,res)=>{res.writeHead(200);res.write("abcdef");res.end("more");});
    await expect(storage.get("trade-screenshots","owner/file",4)).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"});
  });
  it("rejects truncated bytes rather than treating an aborted body as complete",async()=>{
    const storage=await endpoint((_,res)=>{res.writeHead(200,{"content-length":"4"});res.write("ab");setImmediate(()=>res.destroy());});
    await expect(storage.get("trade-screenshots","owner/file",4)).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"});
  });
  it("uploads exact bytes without upsert and records only a hash in Storage metadata",async()=>{
    const bytes=Buffer.alloc(393216,42);let received=Buffer.alloc(0);
    const storage=await endpoint((req,res)=>{
      expect(req.method).toBe("POST");expect(req.headers["content-length"]).toBe(String(bytes.length));expect(req.headers["x-upsert"]).toBe("false");
      expect(JSON.parse(Buffer.from(String(req.headers["x-metadata"]),"base64").toString())).toEqual({tradeOsSha256:fileDigest(bytes)});
      req.on("data",b=>{received=Buffer.concat([received,b]);});req.on("end",()=>res.end("{}"));
    });
    await storage.put("trade-file-staging","owner/file",bytes,"application/octet-stream");
    expect(received.length).toBe(bytes.length);expect(received.equals(bytes)).toBe(true);
  });
  it("recovers a stored original before another POST by reading and hashing, never overwriting",async()=>{
    const bytes=Buffer.from("same");const methods:string[]=[];
    const storage=await endpoint((req,res)=>{methods.push(req.method!); if(req.method==="POST"){req.resume();res.writeHead(409);res.end("{}");}else res.end(bytes);});
    await storage.put("trade-screenshots","owner/file",bytes,"image/png");expect(methods).toEqual(["GET"]);
  });
  it("recognizes the wrapped missing-object response before an original upload",async()=>{
    const methods:string[]=[];
    const storage=await endpoint((req,res)=>{methods.push(req.method!); if(req.method==="GET"){res.writeHead(400);res.end('{"statusCode":"404","error":"not_found"}');}else{req.resume();res.end("{}");}});
    await storage.put("trade-screenshots","owner/file",Buffer.from("image fixture"),"image/png");expect(methods).toEqual(["GET","POST"]);
  });
  it("leaves duplicate staging acceptance to the authoritative stored-fact commit",async()=>{
    const methods:string[]=[];
    const storage=await endpoint((req,res)=>{methods.push(req.method!);req.resume();res.writeHead(409);res.end("{}");});
    await storage.put("trade-file-staging","owner/file",Buffer.from("same"),"application/octet-stream");expect(methods).toEqual(["POST"]);
  });
  it("does not treat an authorization error as a missing original",async()=>{
    const methods:string[]=[];
    const storage=await endpoint((req,res)=>{methods.push(req.method!);res.writeHead(400);res.end('{"statusCode":"403","error":"denied"}');});
    await expect(storage.put("trade-screenshots","owner/file",Buffer.from("same"),"image/png")).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"});expect(methods).toEqual(["GET"]);
  });
  it("rejects a collision with different stored bytes",async()=>{
    const storage=await endpoint((req,res)=>{if(req.method==="POST"){req.resume();res.writeHead(409);res.end("{}");}else res.end("diff");});
    await expect(storage.put("trade-screenshots","owner/file",Buffer.from("same"),"image/png")).rejects.toMatchObject({code:"FILE_CONTENT_CONFLICT"});
  });
  it("requires a server-only supported key and HTTPS except explicit loopback tests",async()=>{
    await endpoint((_,res)=>res.end("unused"));vi.stubEnv("TRADE_OS_LOCAL_TEST_APP","false");
    expect(()=>privateFileStorage()).toThrow("Private Storage is not configured");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://fixture.supabase.co");vi.stubEnv("SUPABASE_SECRET_KEY","");
    expect(()=>privateFileStorage()).toThrow("Private Storage is not configured");
  });
});
