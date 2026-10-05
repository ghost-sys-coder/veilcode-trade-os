import { describe,expect,it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

function fixture(currencyCode:string,currencyPrecision:number,netPnl:string|null) {
  const rows:Record<string,object[]>={
    trading_accounts:[{id:"account",name:"Demo",currency_code:currencyCode,currency_precision:currencyPrecision}],
    instruments:[{id:"instrument",symbol:"EURUSD",display_name:"Euro / Dollar"}],
    trades:[{id:"trade",account_id:"account",instrument_id:"instrument",strategy_id:null,setup_id:null,direction:"BUY",session:"OTHER",
      status:netPnl===null?"OPEN":"CLOSED",outcome:netPnl===null?null:netPnl==="0"?"BREAK_EVEN":"WIN",
      opened_at:"2026-01-01T00:00:00Z",planned_at:null,closed_at:netPnl===null?null:"2026-01-02T00:00:00Z",created_at:"2026-01-01T00:00:00Z",
      planned_risk_amount:"1.25",net_pnl:netPnl,commission:"0",swap:"0",other_fees:"0",trading_credits:"0"}],
  };
  const client={from:(table:string)=>({select:()=>{
    const response=Promise.resolve({error:null,data:rows[table]??[]});
    return {order:()=>response,then:response.then.bind(response)};
  }})};
  return client as unknown as SupabaseClient<Database>;
}
describe("journal monetary display uses centralized account precision",()=>{
  it.each([["USD",2,"95","95.00","1.25"],["JPY",0,"95","95","1"],["KWD",3,"95.006","95.006","1.250"],
    ["USD",2,"0","0.00","1.25"]] as const)("normalizes %s at %i decimals",async(code,precision,input,net,risk)=>{
    const result=await getTradeJournalDataset(fixture(code,precision,input));
    expect(result.trades[0].netPnl).toBe(net);expect(result.trades[0].plannedRiskAmount).toBe(risk);
    expect(result.trades[0].raw.net_pnl).toBe(input); // Canonical export evidence is not reformatted.
  });
  it("preserves absent realized PnL instead of displaying a zero for open trades",async()=>{
    expect((await getTradeJournalDataset(fixture("USD",2,null))).trades[0].netPnl).toBe(null);
  });
});
