import { describe,it,expect } from "vitest";
import { accountEventCommand,prepareAccountEvent } from "@/domain/accounts/events";
const identity={operationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",accountId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};
const occurredAt="2026-10-08T00:00:00Z";
describe("account event commands",()=>{
  it("rejects unclassified OTHER and misclassified fixed cash movements",()=>{
    expect(()=>accountEventCommand("ADJUSTMENT",{...identity,type:"OTHER",amount:"1",occurredAt})).toThrow();
    expect(()=>accountEventCommand("ADJUSTMENT",{...identity,type:"DEPOSIT",amount:"1",occurredAt,isPerformanceNeutral:false})).toThrow();
  });
  it.each([["DEPOSIT","-1.005",2,"1.01"],["WITHDRAWAL","1.005",2,"-1.01"],["DEPOSIT","0.5",0,"1"],["OTHER","-0.0005",3,"-0.001"]] as const)("normalizes %s at account precision",(type,amount,precision,result)=>{
    const request=accountEventCommand("ADJUSTMENT",{...identity,type,amount,occurredAt,...(type==="OTHER"?{isPerformanceNeutral:false,classificationReason:"Explicit economic impact"}:{})});
    expect(prepareAccountEvent(request,{account:{currency_precision:precision}})).toEqual({amount:result});
  });
  it("derives equity without floating-point drift",()=>{
    const request=accountEventCommand("SNAPSHOT",{...identity,balance:"0.1",unrealizedPnl:"0.2",capturedAt:occurredAt});
    expect(prepareAccountEvent(request,{account:{currency_precision:2}})).toEqual({balance:"0.10",equity:"0.30",unrealizedPnl:"0.20"});
  });
  it("flags contradictory snapshot evidence",()=>{
    const request=accountEventCommand("SNAPSHOT",{...identity,balance:"1000",equity:"1001",unrealizedPnl:"5",capturedAt:occurredAt});
    expect(()=>prepareAccountEvent(request,{account:{currency_precision:2}})).toThrow("Snapshot equation conflict");
  });
  it("requires lifecycle reason and explicit failure classification",()=>{
    expect(()=>accountEventCommand("TRANSITION",{...identity,expectedVersion:"1",status:"FAILED",reason:"Reason test",effectiveAt:occurredAt})).toThrow();
    expect(()=>accountEventCommand("TRANSITION",{...identity,expectedVersion:"1",status:"ACTIVE",reason:"",effectiveAt:occurredAt})).toThrow();
  });
});
