import { afterEach,describe,expect,it,vi } from "vitest";
import { instrumentValuesSchema,referenceCreateSchema,referencePatchSchema,referenceArchiveSchema,referenceListSchema,
  parseReferenceCommand,tradeTagCommandSchema } from "@/domain/references/commands";
import { getReference,listReferences,writeReference,listTradeTags,writeTradeTag,listBrowserTags,listBrowserTradeTags } from "@/services/application/references";
import type { ApplicationContext } from "@/services/application/transaction";
const {transaction}=vi.hoisted(()=>({transaction:vi.fn()}));
vi.mock("@/services/application/transaction",()=>({applicationTransaction:transaction}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",later="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context={userId:id} as ApplicationContext;
const create={entity:"TAG",operationId:id,values:{name:" FOMO ",color:null}};
const instrument={symbol:"EURUSDm",display_name:"Euro dollar",asset_class:"FOREX",base_currency:"EUR",quote_currency:"USD",pip_size:"0.0000000001",price_precision:10,active:true};
const tag={id,user_id:id,name:"FOMO",color:null,normalized_name:"fomo",record_version:"1",archived_at:null,created_at:"2026-10-08T00:00:00Z",updated_at:"2026-10-08T00:00:00Z"};
afterEach(()=>vi.resetAllMocks());
describe("reference boundaries",()=>{
  it("trims display name, preserves case and adds an adapter-owned action",()=>expect(parseReferenceCommand("CREATE",create)).toEqual({...create,values:{name:"FOMO",color:null},action:"CREATE"}));
  it.each([{user_id:id},{normalized_name:"override"},{record_version:"12"},{archived_at:null}])("rejects protected fields %j",extra=>expect(referenceCreateSchema.safeParse({...create,values:{...create.values,...extra}}).success).toBe(false));
  it("owner cannot be supplied at command level",()=>expect(referenceCreateSchema.safeParse({...create,user_id:id}).success).toBe(false));
  it("omission differs from nullable clearing",()=>expect(referencePatchSchema.parse({entity:"TAG",id,operationId:id,expectedVersion:"1",values:{color:null}}).values).toEqual({color:null}));
  it.each([{}, {name:null},{color:"red"}])("rejects invalid tag patch %j",values=>expect(referencePatchSchema.safeParse({entity:"TAG",id,operationId:id,expectedVersion:"1",values}).success).toBe(false));
  it("archive requires a reason and version",()=>{
    expect(referenceArchiveSchema.safeParse({entity:"TAG",id,operationId:id,expectedVersion:"1",reason:" "}).success).toBe(false);
    expect(referenceArchiveSchema.safeParse({entity:"INSTRUMENT",id,operationId:id,reason:"Retire unused symbol"}).success).toBe(false);
  });
  it("does not round pip size to currency precision",()=>expect(instrumentValuesSchema.parse(instrument).pip_size).toBe("0.0000000001"));
  it.each([0.0001,"0","-0.01","1e-4","0.00000000001","100000000000000.0"])("rejects invalid or unrepresentable pip %s",pip_size=>expect(instrumentValuesSchema.safeParse({...instrument,pip_size}).success).toBe(false));
  it.each([0,101,1.5])("bounds pages %s",limit=>expect(referenceListSchema.safeParse({entity:"TAG",limit}).success).toBe(false));
  it("link commands require both versions without accepting numbers",()=>{
    expect(tradeTagCommandSchema.safeParse({operationId:id,tradeId:id,tagId:id,expectedVersion:"1"}).success).toBe(false);
    expect(tradeTagCommandSchema.safeParse({operationId:id,tradeId:id,tagId:id,expectedVersion:1,expectedTagVersion:"1"}).success).toBe(false);
  });
});
describe("shared reference adapter",()=>{
  it("validates before contacting the database",async()=>{await expect(writeReference(context,"CREATE",{...create,user_id:id})).rejects.toThrow();expect(transaction).not.toHaveBeenCalled();});
  it("uses fixed read and write transactions",async()=>{
    transaction.mockResolvedValueOnce(tag).mockResolvedValueOnce({entity:"TAG",action:"CREATE",record:tag});
    expect(await getReference(context,{entity:"TAG",id})).toEqual(tag);
    await writeReference(context,"CREATE",create);
    expect(transaction).toHaveBeenCalledWith(context,"REFERENCE_READ",{entity:"TAG",id});
    expect(transaction).toHaveBeenCalledWith(context,"REFERENCE_WRITE",{entity:"TAG",operationId:id,action:"CREATE",values:{name:"FOMO",color:null}});
  });
  it("list defaults to current references only",async()=>{
    transaction.mockResolvedValue({records:[],nextCursor:null});await listReferences(context,{entity:"INSTRUMENT"});
    expect(transaction).toHaveBeenCalledWith(context,"REFERENCE_READ",{entity:"INSTRUMENT",limit:50,includeArchived:false});
  });
  it("trade labels include historical archives",async()=>{
    transaction.mockResolvedValue({records:[{...tag,archived_at:"2026-10-08T01:00:00Z"}],nextCursor:null});
    expect((await listTradeTags(context,{tradeId:id})).records).toHaveLength(1);
    expect(transaction).toHaveBeenCalledWith(context,"REFERENCE_READ",{entity:"TAG",tradeId:id,limit:50,includeArchived:true});
  });
  it.each(["ASSIGN","REMOVE"] as const)("uses audited %s transaction",async action=>{
    const input={operationId:id,tradeId:id,tagId:id,expectedVersion:"9007199254740993",expectedTagVersion:"2"};
    transaction.mockResolvedValue({action,tradeId:id,tagId:id,assigned:action==="ASSIGN",tradeVersion:"9007199254740994"});
    expect((await writeTradeTag(context,action,input)).tradeVersion).toBe("9007199254740994");
    expect(transaction).toHaveBeenCalledWith(context,"TRADE_TAG_WRITE",{...input,action});
  });
  it.each([false,true])("browser tag library exhausts pages (trade=%s)",async trade=>{
    transaction.mockResolvedValueOnce({records:[tag],nextCursor:id}).mockResolvedValueOnce({records:[{...tag,id:later,name:"Fear"}],nextCursor:null});
    expect(await (trade?listBrowserTradeTags(context,id):listBrowserTags(context))).toHaveLength(2);
    expect(transaction.mock.calls[1][2]).toMatchObject({afterId:id,limit:100});
  });
});
