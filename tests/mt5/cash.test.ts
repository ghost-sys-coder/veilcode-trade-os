import { describe,expect,it } from "vitest";
import { cashMovementAmount,mt5CashRequestSchema,prepareMt5CashDecision } from "@/domain/mt5/cash";
import { mt5StoredSourceSchema } from "@/domain/mt5/onboarding";
import type { Mt5Deal } from "@/domain/mt5/source";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request=mt5CashRequestSchema.parse({connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),
  sourceTicket:"100",sourceRevisionId:"1",disposition:"ADJUSTMENT",adjustmentType:"OTHER",isPerformanceNeutral:false,existingAdjustmentId:null,reason:"Explicit broker cash interpretation"});
const deal:Mt5Deal={ticket:"100",orderId:null,positionId:null,symbol:null,occurredAt:"2026-01-01T00:00:00.000Z",type:"CHARGE",entry:null,
  volume:"0",price:"0",profit:"-5",commission:"0",swap:"0",fee:"-0.125"};
const source=(payload:Mt5Deal=deal)=>mt5StoredSourceSchema.parse({kind:"DEAL",sourceId:payload.ticket,revisionId:"1",observedAt:payload.occurredAt,requiresReview:false,payload});

describe("explicit source-backed MT5 cash classification",()=>{
  it("includes signed fees and rounds once, not each intermediate component",()=>{
    expect(prepareMt5CashDecision([source()],request,2)).toEqual({amount:"-5.13",occurredAt:deal.occurredAt});
    expect(cashMovementAmount({...deal,profit:"0.004",commission:"0.004",swap:"0.004",fee:"0.004"},2)).toBe("0.02");
  });
  it.each([[0,"-5"],[2,"-5.13"],[3,"-5.125"],[20,"-5.12500000000000000000"]] as const)("uses configured precision %s",(precision,amount)=>{
    expect(cashMovementAmount(deal,precision)).toBe(amount);
  });
  it("does not truncate precision-20 charges or use near-zero tolerance",()=>{
    expect(cashMovementAmount({...deal,profit:"-0.000000000000000001",fee:"0"},20)).toBe("-0.00000000000000000100");
    expect(()=>prepareMt5CashDecision([source()],{...request,disposition:"ZERO_EFFECT",adjustmentType:null,isPerformanceNeutral:null},2)).toThrow();
    expect(prepareMt5CashDecision([source({...deal,profit:"0.004",fee:"0"})],{...request,disposition:"ZERO_EFFECT",adjustmentType:null,isPerformanceNeutral:null},2).amount).toBe("0.00");
    expect(()=>prepareMt5CashDecision([source({...deal,profit:"0.004",fee:"0"})],request,2)).toThrow();
  });
  it("accepts explicit false for OTHER but rejects unanswered classification and contradictory fields",()=>{
    expect(mt5CashRequestSchema.parse(request).isPerformanceNeutral).toBe(false);
    for(const change of [{isPerformanceNeutral:null},{adjustmentType:null},{existingAdjustmentId:id},{reason:""},
      {adjustmentType:"DEPOSIT"},{amount:"100"},{ownerId:id},{sourceTicket:100}])
      expect(mt5CashRequestSchema.safeParse({...request,...change}).success).toBe(false);
    expect(mt5CashRequestSchema.safeParse({...request,disposition:"LINK_EXISTING",existingAdjustmentId:id}).success).toBe(true);
  });
  it.each(["CREDIT","BUY","SELL","BUY_CANCELED"] as const)("never invents cash interpretation for %s",type=>{
    expect(()=>prepareMt5CashDecision([source({...deal,type})],request,2)).toThrow();
  });
  it("requires current, reviewed, non-position source evidence",()=>{
    expect(()=>prepareMt5CashDecision([],request,2)).toThrow();
    expect(()=>prepareMt5CashDecision([{...source(),revisionId:"2"}],request,2)).toThrow();
    expect(()=>prepareMt5CashDecision([{...source(),requiresReview:true}],request,2)).toThrow();
    expect(()=>prepareMt5CashDecision([source({...deal,positionId:"100"})],request,2)).toThrow();
  });
  it("checks fixed adjustment types and baseline funding against source type and direction",()=>{
    const funding=source({...deal,type:"BALANCE",profit:"1000",fee:"0"});
    expect(prepareMt5CashDecision([funding],{...request,disposition:"BASELINE_FUNDING",adjustmentType:null,isPerformanceNeutral:null},2).amount).toBe("1000.00");
    expect(prepareMt5CashDecision([funding],{...request,adjustmentType:"DEPOSIT",isPerformanceNeutral:true},2).amount).toBe("1000.00");
    expect(()=>prepareMt5CashDecision([funding],{...request,adjustmentType:"WITHDRAWAL",isPerformanceNeutral:true},2)).toThrow();
    expect(()=>prepareMt5CashDecision([source()],{...request,adjustmentType:"BALANCE_CORRECTION",isPerformanceNeutral:true},2)).toThrow();
  });
});
