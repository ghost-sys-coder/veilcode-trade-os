import { describe,expect,it } from "vitest";
import { captureInputSchema,captureResultSchema,collectionSchema } from "@/domain/mt5/protocol";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("complete-collection capture protocol", () => {
  it.each([{ id,index: -1,count: 1 },{ id,index: 1,count: 1 },{ id,index: 0,count: 0 },{ id,index: 0,count: 100_001 },
    { id,index: "0",count: 1 },{ id,index: 0.5,count: 1 },{ id,index: 0,count: 1,ownerId: id }])("rejects invalid or expanded manifests",manifest => {
    expect(collectionSchema.safeParse(manifest).success).toBe(false);
  });
  it("accepts the final slot without treating it as complete", () => {
    expect(collectionSchema.parse({ id,index: 99_999,count: 100_000 })).toEqual({ id,index: 99_999,count: 100_000 });
  });
  it("requires a manifest even for empty or single-page captures", () => {
    const input = { connectionId: id,workerId: id,operationId: id,fencingToken: "1",checkpoint: "2026-01-01T00:00:00.000Z",events: [],
      identity: { server: "Broker-Demo",login: "12345",terminalInstallationId: id,currencyCode: "USD",currencyPrecision: 2,accountKind: "DEMO",positionMode: "NETTING" } };
    expect(captureInputSchema.safeParse(input).success).toBe(false);
    expect(captureInputSchema.safeParse({ ...input,collection: { id,index: 0,count: 1 } }).success).toBe(true);
  });
  it("preserves an unavailable checkpoint before first complete collection", () => {
    const result = captureResultSchema.parse({ connectionId: id,status: "STAGED",revisionCount: 0,checkpoint: null,collectionId: id,
      collectionComplete: false,receivedBatchCount: 1,reviewCount: 0 });
    expect(result.status).toBe("STAGED");
    if (result.status === "STAGED") expect(result.checkpoint).toBeNull();
  });
});
