import { afterEach, describe, expect, it, vi } from "vitest";
import { deletionInspectSchema, deletionRequestSchema, deletionDecisionSchema, deletionExecuteSchema } from "@/domain/deletions/commands";
import { inspectDeletion, requestDeletion, executeDeletion, resumeDeletion } from "@/services/application/deletions";
import type { ApplicationContext } from "@/services/application/transaction";
import { recordVersionSchema } from "@/domain/configuration/commands";
const {transaction, remove, browserClaims} = vi.hoisted(()=>({transaction:vi.fn(),remove:vi.fn(),browserClaims:vi.fn()}));
vi.mock("@/services/application/transaction",async original=>({...await original<typeof import("@/services/application/transaction")>(),applicationTransaction:transaction}));
vi.mock("@/services/files/removal",()=>({removeDeletionObjects:remove}));
vi.mock("@/services/integrations/browser-context",()=>({verifiedBrowserClaims:browserClaims}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",context={} as ApplicationContext;
const request={operationId:id,entity:"STRATEGY",id:other,expectedVersion:"1",executionOperationId:other,reason:"Remove unused fixture"};
const record={requestId:id,target:{entity:"SCREENSHOT",id:other,version:"a".repeat(64),name:"Chart",tradeId:other,accountName:"Demo",referenceCount:0,effect:"DELETE"},
  clientName:"Fixture",clientId:other,executionOperationId:other,reason:"Remove fixture",status:"PURGE_PENDING",version:"3",expiresAt:"2026-10-10T00:00:00Z",approvedAt:"2026-10-09T00:00:00Z",consumedAt:"2026-10-09T00:01:00Z",completedAt:null};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe("deletion schemas and verified services",()=>{
  it.each(["ACCOUNT","TRADE","ADJUSTMENT","CORRECTION","AUDIT","IMPORT","SQL"])("excludes immutable or administrative entity %s",entity=>expect(deletionInspectSchema.safeParse({entity,id}).success).toBe(false));
  it.each([{ownerId:id},{storagePath:"../outside"},{expectedVersion:1},{reason:""},{executionOperationId:id},{sql:"delete from trades"}])("rejects forged request %j",extra=>expect(deletionRequestSchema.safeParse({...request,...extra}).success).toBe(false));
  it("requires explicit approve acknowledgement; rejection is not consent",()=>{
    expect(deletionDecisionSchema.safeParse({operationId:id,requestId:other,expectedVersion:"1",decision:"APPROVE",acknowledged:false}).success).toBe(false);
    expect(deletionDecisionSchema.safeParse({operationId:id,requestId:other,expectedVersion:"1",decision:"REJECT",acknowledged:false}).success).toBe(true);
    expect(deletionExecuteSchema.safeParse({operationId:id,requestId:other,approved:true}).success).toBe(false);
  });
  it.each(["bad", "", "0", "-1", "9223372036854775808", "G".repeat(64)])("rejects invalid versions without throwing during safeParse (%s)",expectedVersion=>{
    expect(deletionRequestSchema.safeParse({...request,expectedVersion}).success).toBe(false);
    expect(recordVersionSchema.safeParse(expectedVersion).success).toBe(false);
  });
  it("does not perform irreversible I/O if database authorization fails",async()=>{
    transaction.mockRejectedValue(new Error("Access denied"));await expect(executeDeletion(context,{operationId:other,requestId:id})).rejects.toThrow("Access denied");expect(remove).not.toHaveBeenCalled();
  });
  it("does not open a transaction for malformed or owner-injected input",async()=>{await expect(inspectDeletion(context,{entity:"STRATEGY",id,ownerId:other})).rejects.toThrow();expect(transaction).not.toHaveBeenCalled();});
  it("returns a same-origin normal-browser link, not a bearer token",async()=>{
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");transaction.mockResolvedValue({action:"REQUEST",request:{...record,status:"PENDING"}});
    expect((await requestDeletion(context,request)).approvalUrl).toBe(`https://trade.example/settings/integrations/deletions/${id}`);
  });
  it("does not touch Storage unless the committed receipt starts a purge",async()=>{
    const receipt={action:"EXECUTE",request:{...record,status:"ARCHIVED"}};transaction.mockResolvedValue(receipt);
    expect(await executeDeletion(context,{operationId:other,requestId:id})).toEqual(receipt);expect(remove).not.toHaveBeenCalled();
  });
  it("preserves accepted pending receipt on Storage outage and does not settle",async()=>{
    const receipt={action:"EXECUTE",request:record};transaction.mockResolvedValueOnce(receipt).mockResolvedValueOnce({requestId:id,ownerId:id,tradeId:other,settleOperationId:other,objects:[{bucket:"trade-screenshots",path:`${id}/${other}/image.png`}]});remove.mockRejectedValue(new Error("Fixture outage"));
    expect(await executeDeletion(context,{operationId:other,requestId:id})).toEqual(receipt);expect(transaction).toHaveBeenCalledTimes(2);
  });
  it("reauthorizes before removal and settles using frozen operation, not caller fields",async()=>{
    const receipt={action:"EXECUTE",request:record},job={requestId:id,ownerId:id,tradeId:other,settleOperationId:other,objects:[{bucket:"trade-screenshots",path:`${id}/${other}/image.png`}]};
    transaction.mockResolvedValueOnce(receipt).mockResolvedValueOnce(job).mockResolvedValueOnce({});
    expect(await executeDeletion(context,{operationId:other,requestId:id})).toEqual(receipt);expect(remove).toHaveBeenCalledWith(job);
    expect(transaction).toHaveBeenLastCalledWith(context,"DELETION_WRITE",{action:"SETTLE",operationId:other,requestId:id});
  });
  it("requires runtime-verified browser provenance for operator recovery",async()=>{
    browserClaims.mockImplementation(()=>{throw new Error("Forged browser");});
    await expect(resumeDeletion(context as never,{requestId:id})).rejects.toThrow("Forged browser");expect(transaction).not.toHaveBeenCalled();
  });
});
