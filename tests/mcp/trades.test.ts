import { describe,it,expect } from "vitest";
import { tradeCommand,prepareTrade } from "@/domain/trades/commands";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account={currency_precision:2,starting_balance:"1000",closed_trade_net_pnl:"0",account_adjustments_total:"0"};
const trade={id,account_id:id,instrument_id:id,direction:"BUY",source_type:"MANUAL",status:"OPEN",opened_at:"2026-10-08T01:00:00Z",closed_at:null,
  commission:"0.10",swap:"0.20",other_fees:"0",trading_credits:"0",gross_pnl:null,planned_risk_amount:"10",planned_reward_amount:"20",planned_stop_loss:"1.08",account_balance_before:"1000"};
const identity={id,operationId:id,expectedVersion:"1"};
describe("canonical trade command boundaries",()=>{
  it.each([{user_id:id},{source_type:"MT5"},{net_pnl:"1"},{outcome:"WIN"},{actual_r:"1"},{mt5_connection_id:id}])("rejects caller-owned source/derived fields %j",values=>{
    expect(()=>tradeCommand("PATCH",{...identity,values})).toThrow();
  });
  it("never treats number as a decimal string",()=>expect(()=>tradeCommand("PATCH",{...identity,values:{gross_pnl:0.1}})).toThrow());
  it.each(["commission","swap","other_fees","trading_credits"])("rejects clearing nonnullable %s instead of accepting an invalid patch",field=>expect(()=>tradeCommand("PATCH",{...identity,values:{[field]:null}})).toThrow());
  it("accepts PostgreSQL UTC without losing fractions but rejects non-UTC wire offsets",()=>{
    expect(()=>tradeCommand("PATCH",{...identity,values:{opened_at:"2026-10-08T01:00:21.333999+00:00"}})).not.toThrow();
    expect(()=>tradeCommand("PATCH",{...identity,values:{opened_at:"2026-10-08T01:00:21+03:00"}})).toThrow();
  });
  it("preserves omission and nullable clearing",()=>expect(tradeCommand("PATCH",{...identity,values:{thesis:null}})).toMatchObject({values:{thesis:null}}));
  it("rejects protected changes after OPEN",()=>expect(()=>prepareTrade(tradeCommand("PATCH",{...identity,values:{planned_stop_loss:"1.09"}}),{account,trade,targets:[]})).toThrow("Recorded plans"));
  it("accepts identical numeric spelling for a locked value",()=>expect(()=>prepareTrade(tradeCommand("PATCH",{...identity,values:{planned_stop_loss:"1.0800"}}),{account,trade,targets:[]})).not.toThrow());
  it.each(["MT4","MT5","BROKER_API"])("protects %s execution facts",source_type=>expect(()=>prepareTrade(tradeCommand("PATCH",{...identity,values:{gross_pnl:"5"}}),{account,trade:{...trade,source_type},targets:[]})).toThrow("Broker execution"));
  it.each([["0.31",false,"0.01","WIN"],["0.29",false,"-0.01","LOSS"],["0.30",true,"0.00","BREAK_EVEN"],["0.31",true,"0.01","PARTIAL_WIN"],["0.29",true,"-0.01","PARTIAL_LOSS"]] as const)
    ("finalizes %s with partial=%s",(gross,partial,pnl,outcome)=>{
      const request=tradeCommand("PATCH",{...identity,values:{status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:gross}});
      expect(prepareTrade(request,{account,trade,targets:partial?[{actual_close_percentage:"50"}]:[]})).toMatchObject({values:{net_pnl:pnl,outcome,holding_duration_seconds:"3600"}});
    });
  it("keeps partial cash unrealized while canonical position remains OPEN",()=>expect(prepareTrade(tradeCommand("PATCH",{...identity,values:{gross_pnl:"50"}}),{account,trade,targets:[{actual_close_percentage:"50",pnl_contribution:"50"}]})).toMatchObject({values:{net_pnl:null,outcome:null,actual_r:null}}));
  it.each([["JPY",0,"1","0","1"],["KWD",3,"0.0005","0","0.001"]] as const)("uses configured %s precision",(_,precision,gross,fees,pnl)=>{
    expect(prepareTrade(tradeCommand("PATCH",{...identity,values:{status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:gross,commission:fees,swap:fees}}),{account:{...account,currency_precision:precision},trade,targets:[]})).toMatchObject({values:{net_pnl:pnl}});
  });
  it("does not manufacture zero R for missing risk",()=>expect(prepareTrade(tradeCommand("PATCH",{...identity,values:{status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:"1"}}),{account,trade:{...trade,planned_risk_amount:null},targets:[]})).toMatchObject({values:{actual_r:null}}));
  it("credits add to final result separately from nonnegative costs",()=>expect(prepareTrade(tradeCommand("PATCH",{...identity,values:{status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:"0",trading_credits:"0.31"}}),{account,trade,targets:[]})).toMatchObject({values:{net_pnl:"0.01",outcome:"WIN"}}));
  it("retains fee component precision and rounds the complete net result only once",()=>expect(prepareTrade(tradeCommand("PATCH",{...identity,values:{status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:"1.004",commission:"0.005",swap:"0"}}),{account,trade,targets:[]})).toMatchObject({values:{gross_pnl:"1.004",commission:"0.005",net_pnl:"1.00"}}));
  it("recalculates R when recorded risk is corrected",()=>expect(prepareTrade(tradeCommand("CORRECT",{...identity,fieldName:"planned_risk_amount",newValue:"20",reason:"Recorded risk correction"}),{account,trade:{...trade,status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:"10.30"},targets:[]})).toMatchObject({correctedValue:"20.00",values:{actual_r:"0.50000000",planned_risk_percentage:"2.000000",planned_risk_reward:"1.00000000"}}));
  it("rejects target totals across both existing and patched executions",()=>expect(()=>prepareTrade(tradeCommand("TARGETS",{...identity,executedTargets:[{id,actual_close_percentage:"60"}]}),{account,trade,targets:[{id,actual_close_percentage:"50"},{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",actual_close_percentage:"50"}]})).toThrow("percentages exceed"));
  it("preserves omitted execution fields and normalizes target cash",()=>expect(prepareTrade(tradeCommand("TARGETS",{...identity,executedTargets:[{id,pnl_contribution:"0.105"}]}),{account,trade,targets:[{id,actual_close_percentage:"50",actual_fill_price:"1.10"}]})).toMatchObject({executedTargets:[{id,actual_close_percentage:"50",actual_fill_price:"1.10",pnl_contribution:"0.11"}]}));
  it("a scale-out event uses partial outcome only on complete closure",()=>expect(prepareTrade(tradeCommand("MANAGEMENT",{...identity,event:{event_type:"SCALE_OUT",occurred_at:"2026-10-08T01:30:00Z",volume:"0.5",notes:"Recorded partial exit"}}),{account,trade:{...trade,status:"CLOSED",closed_at:"2026-10-08T02:00:00Z",gross_pnl:"1"},targets:[]})).toMatchObject({values:{outcome:"PARTIAL_WIN"}}));
});
