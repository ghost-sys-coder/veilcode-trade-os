import { afterEach, describe, expect, it, vi } from "vitest";
import { accountCreateSchema, accountPatchSchema, accountWithBalance } from "@/domain/accounts/commands";
import { ACCOUNT_CURRENCY_CODES } from "@/domain/money/currency-codes";
import { getAccount, listAccounts, listBrowserAccounts, writeAccount } from "@/services/application/accounts";
import type { ApplicationContext } from "@/services/application/transaction";

const { transaction }=vi.hoisted(()=>({transaction:vi.fn()}));
vi.mock("@/services/application/transaction",()=>({applicationTransaction:transaction}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const values={name:"Account fixture",account_type:"DEMO",broker_name:null,platform:"OTHER",currency_code:"USD",currency_precision:2,
  starting_balance:"1000",leverage:null,started_at:"2026-09-01",notes:null,status:"ACTIVE"};
const row={...values,id,user_id:id,previous_account_id:null,record_version:"1",created_at:"2026-10-08T00:00:00Z",updated_at:"2026-10-08T00:00:00Z",
  closed_trade_net_pnl:"0.01",account_adjustments_total:"45",closed_trade_count:"2",unclassified_other_count:"0"};
const context={userId:id} as ApplicationContext;
afterEach(()=>vi.resetAllMocks());
describe("account schemas and monetary projection",()=>{
  it("publishes a fixed registered currency snapshot without implicit precision",()=>{
    expect(ACCOUNT_CURRENCY_CODES).toHaveLength(176);expect(new Set(ACCOUNT_CURRENCY_CODES).size).toBe(176);
    expect(ACCOUNT_CURRENCY_CODES).toContain("KWD");expect(ACCOUNT_CURRENCY_CODES).not.toContain("XTS");expect(ACCOUNT_CURRENCY_CODES).not.toContain("XXX");
  });
  it.each([{starting_balance:1000},{starting_balance:"0"},{currency_code:"AAA"},{currency_code:"XXX"},{currency_precision:21},
    {started_at:"2026-02-30"},{status:"FAILED"},{leverage:"0"},{leverage:100}])("rejects invalid account values %j",change=>{
    expect(accountCreateSchema.safeParse({operationId:id,values:{...values,...change}}).success).toBe(false);
  });
  it("keeps omitted and null fields distinct",()=>{
    const input=accountPatchSchema.parse({operationId:id,id,expectedVersion:"1",values:{notes:null}});
    expect(input.values).toEqual({notes:null});expect("starting_balance" in input.values).toBe(false);
  });
  it.each([{user_id:id},{status:"PASSED"},{previous_account_id:id},{record_version:"2"},{currency_precision:null},{}])("rejects protected/invalid patches %j",patch=>{
    expect(accountPatchSchema.safeParse({operationId:id,id,expectedVersion:"1",values:patch}).success).toBe(false);
  });
  it("projects authoritative balance without treating adjustments as profit",()=>{
    expect(accountWithBalance({...row,starting_balance:"1100"})).toMatchObject({derived_balance:"1145.01",closed_trade_net_pnl:"0.01",account_adjustments_total:"45.00"});
  });
  it.each([["JPY",0,"1000","12","-2","1010"],["KWD",3,"1","-0.001","0.005","1.004"],["USD",2,"0.1","0.2","0.3","0.60"]] as const)
    ("uses explicit %s precision rather than assuming two decimal places",(currency,precision,starting,pnl,adjustments,expected)=>{
      expect(accountWithBalance({...row,currency_code:currency,currency_precision:precision,starting_balance:starting,
        closed_trade_net_pnl:pnl,account_adjustments_total:adjustments}).derived_balance).toBe(expected);
    });
});
describe("account application adapters",()=>{
  it("reads one verified account with the central balance calculation",async()=>{
    transaction.mockResolvedValue(row);expect((await getAccount(context,{id})).derived_balance).toBe("1045.01");
    expect(transaction).toHaveBeenCalledWith(context,"ACCOUNT_READ",{id});
  });
  it("maps all returned records independently without mixing currencies",async()=>{
    transaction.mockResolvedValue({records:[row,{...row,currency_code:"JPY",currency_precision:0,closed_trade_net_pnl:"1",account_adjustments_total:"0"}],nextCursor:null});
    expect((await listAccounts(context,{})).records.map(item=>[item.currency_code,item.derived_balance])).toEqual([["USD","1045.01"],["JPY","1001"]]);
  });
  it("adds an adapter-owned action and returns an explicit normalized result",async()=>{
    transaction.mockResolvedValue({action:"CREATE",record:row});expect((await writeAccount(context,"CREATE",{operationId:id,values})).action).toBe("CREATE");
    expect(transaction).toHaveBeenCalledWith(context,"ACCOUNT_WRITE",{operationId:id,values,action:"CREATE"});
  });
  it("rejects submitted ownership fields before invoking a privileged workflow",async()=>{
    await expect(writeAccount(context,"CREATE",{operationId:id,owner_id:id,values})).rejects.toThrow();expect(transaction).not.toHaveBeenCalled();
  });
  it("exhausts browser pages without converting large monetary/version values to number",async()=>{
    const later={...row,id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",starting_balance:"9007199254740993.00",record_version:"9007199254740993"};
    transaction.mockResolvedValueOnce({records:[row],nextCursor:id}).mockResolvedValueOnce({records:[later],nextCursor:null});
    const accounts=await listBrowserAccounts(context);expect(accounts).toHaveLength(2);
    expect(accounts[1].starting_balance).toBe("9007199254740993.00");expect(accounts[1].record_version).toBe("9007199254740993");
    expect(transaction).toHaveBeenLastCalledWith(context,"ACCOUNT_READ",{limit:100,afterId:id});
  });
});
