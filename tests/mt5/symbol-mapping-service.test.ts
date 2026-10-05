import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { saveMt5SymbolMapping } from "@/services/mt5/symbol-mapping";
import { mt5SymbolMappingRequestSchema } from "@/domain/mt5/symbol-mapping";

const boundary=vi.hoisted(()=>({context:vi.fn(),transaction:vi.fn()}));
vi.mock("@/services/integrations/browser-context",()=>({getVerifiedBrowserContext:boundary.context}));
vi.mock("@/services/integrations/publication-database",()=>({mt5SymbolMappingTransaction:boundary.transaction}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const client={} as SupabaseClient<IntegrationDatabase>;
const request={connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),brokerSymbol:"EURUSD.m",instrumentId:id,reason:"Confirmed broker suffix"};
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
  boundary.context.mockResolvedValue({verified:true});
  boundary.transaction.mockResolvedValue({connectionId:id,version:"2",brokerSymbol:"EURUSD.m",instrumentId:id,mappingVersion:"1"});
});
afterEach(()=>vi.unstubAllEnvs());
describe("explicit MT5 broker-symbol decisions",()=>{
  it("passes validated decisions and verified actor context, not owner or financial inputs",async()=>{
    expect(await saveMt5SymbolMapping(client,request)).toMatchObject({mappingVersion:"1"});
    expect(boundary.transaction).toHaveBeenCalledWith({verified:true},request);
  });
  it("rejects arbitrary owner fields and missing reasons before privileged work",async()=>{
    await expect(saveMt5SymbolMapping(client,{...request,ownerId:id})).rejects.toThrow();
    await expect(saveMt5SymbolMapping(client,{...request,reason:""})).rejects.toThrow();
    expect(boundary.context).not.toHaveBeenCalled();expect(boundary.transaction).not.toHaveBeenCalled();
  });
  it("requires an enabled integration and a verified browser",async()=>{
    vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    await expect(saveMt5SymbolMapping(client,request)).rejects.toThrow("UNAVAILABLE");
    expect(boundary.context).not.toHaveBeenCalled();
    vi.stubEnv("TRADE_OS_MT5_ENABLED","true");boundary.context.mockRejectedValue(new Error("Browser verification failed"));
    await expect(saveMt5SymbolMapping(client,request)).rejects.toThrow();expect(boundary.transaction).not.toHaveBeenCalled();
  });
  it("preserves exact broker identifiers and accepts the full source symbol length",()=>{
    expect(mt5SymbolMappingRequestSchema.parse({...request,brokerSymbol:"x".repeat(128)}).brokerSymbol).toHaveLength(128);
    expect(()=>mt5SymbolMappingRequestSchema.parse({...request,brokerSymbol:" EURUSD.m "})).toThrow();
    expect(()=>mt5SymbolMappingRequestSchema.parse({...request,instrumentId:null})).toThrow();
  });
});
