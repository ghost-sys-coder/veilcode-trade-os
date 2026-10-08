import {describe,it,expect,afterEach,vi} from "vitest";
import {goalCreateSchema,goalPatchSchema,goalProgressSchema,propSaveSchema,progressCommand,prepareProgress} from "@/domain/progress/commands";
import {buildProgressDataset,progressDatasetResultSchema} from "@/domain/progress/dataset";
import {writeProgress,listGoals} from "@/services/application/progress";
import type {ApplicationContext} from "@/services/application/transaction";
const {transaction}=vi.hoisted(()=>({transaction:vi.fn()}));
vi.mock("@/services/application/transaction",()=>({applicationTransaction:transaction}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",stamp="2026-10-08T00:00:00Z";
const goal={title:"Research sample",goal_type:"TOTAL_TRADES",target_value:"25",target_date:null,custom_unit:null,notes:null,active:true};
const fullGoal={...goal,id,user_id:id,account_id:id,record_version:"1",archived_at:null,achieved_at:null,created_at:stamp,updated_at:stamp};
const snapshot={account:{currency_precision:2},goal:null,config:null};
afterEach(()=>vi.resetAllMocks());
describe("progress command contracts",()=>{
  it.each([{user_id:id},{target_value:25},{goal_type:"CUSTOM",custom_unit:null},{goal_type:"TOTAL_TRADES",target_value:"0.5"},{goal_type:"RULE_COMPLIANCE_PERCENT",target_value:"101"},{target_date:"2026-02-30"}])("rejects invalid goal values %j",change=>expect(goalCreateSchema.safeParse({operationId:id,accountId:id,values:{...goal,...change}}).success).toBe(false));
  it("distinguishes omitted patch fields and nullable clearing",()=>expect(goalPatchSchema.parse({id,operationId:id,expectedVersion:"1",values:{notes:null}}).values).toEqual({notes:null}));
  it("preserves unmodified legacy long notes without truncation or revalidation as new input",()=>{
    const notes="n".repeat(5000);
    expect(prepareProgress(progressCommand("GOAL_PATCH",{id,operationId:id,expectedVersion:"1",values:{title:"Updated title"}}),{...snapshot,goal:{...fullGoal,notes}})).toMatchObject({values:{title:"Updated title",notes}});
    expect(goalPatchSchema.safeParse({id,operationId:id,expectedVersion:"1",values:{notes}}).success).toBe(false);
  });
  it("keeps non-monetary goal precision independent from account currency",()=>expect(prepareProgress(progressCommand("GOAL_CREATE",{operationId:id,accountId:id,values:{...goal,goal_type:"CUMULATIVE_R",target_value:"0.00000001"}}),snapshot)).toMatchObject({values:{target_value:"0.00000001"}}));
  it.each([[0,"1.5","2"],[2,"1.005","1.01"],[3,"1.0005","1.001"]])("normalizes monetary target at precision %s",(precision,target,value)=>expect(prepareProgress(progressCommand("GOAL_CREATE",{operationId:id,accountId:id,values:{...goal,goal_type:"ACCOUNT_BALANCE",target_value:target}}),{...snapshot,account:{currency_precision:precision}})).toMatchObject({values:{target_value:value}}));
  it("rejects a positive money goal that normalizes to zero",()=>expect(()=>prepareProgress(progressCommand("GOAL_CREATE",{operationId:id,accountId:id,values:{...goal,goal_type:"ACCOUNT_BALANCE",target_value:"0.001"}}),snapshot)).toThrow());
  it("requires exact strings and UTC for custom evidence",()=>{
    expect(goalProgressSchema.safeParse({operationId:id,goalId:id,expectedVersion:"1",progressValue:1,recordedAt:stamp}).success).toBe(false);
    expect(goalProgressSchema.safeParse({operationId:id,goalId:id,expectedVersion:"1",progressValue:"1",recordedAt:"2026-10-08T00:00:00+03:00"}).success).toBe(false);
  });
  it("rejects protected prop fields and incomplete new definitions",()=>{
    expect(propSaveSchema.safeParse({operationId:id,accountId:id,expectedVersion:"0",values:{user_id:id}}).success).toBe(false);
    expect(()=>prepareProgress(progressCommand("PROP_SAVE",{operationId:id,accountId:id,expectedVersion:"0",values:{firm_name:"Firm"}}),snapshot)).toThrow();
  });
  it("does not invent optional prop rules",()=>expect(prepareProgress(progressCommand("PROP_SAVE",{operationId:id,accountId:id,expectedVersion:"0",values:{firm_name:"Firm",drawdown_type:"STATIC",trading_day_timezone:"UTC",profitable_day_min_pnl:"0.005"}}),snapshot)).toMatchObject({values:{profit_target_mode:null,daily_loss_value:null,profitable_day_min_pnl:"0.01"}}));
  it("validates before opening privileged workflow",async()=>{await expect(writeProgress({userId:id} as ApplicationContext,"GOAL_CREATE",{operationId:id,accountId:id,values:{...goal,target_value:25}})).rejects.toThrow();expect(transaction).not.toHaveBeenCalled();});
  it("passes bounded pages to a verified actor service",async()=>{transaction.mockResolvedValue({records:[],nextCursor:null});await listGoals({userId:id} as ApplicationContext,{accountId:id});expect(transaction).toHaveBeenCalledWith(expect.anything(),"PROGRESS_READ",{accountId:id,limit:50,includeArchived:false,kind:"GOALS"});});
});
const account={id,user_id:id,name:"Fixture",account_type:"PROP_CHALLENGE",platform:"OTHER",broker_name:null,currency_code:"USD",currency_precision:2,starting_balance:"1000",leverage:null,started_at:"2026-10-01",notes:null,status:"ACTIVE",previous_account_id:null,record_version:"1",created_at:stamp,updated_at:stamp,closed_trade_net_pnl:"50",account_adjustments_total:"900",closed_trade_count:"2",unclassified_other_count:"0"};
const config={id,user_id:id,account_id:id,firm_name:"Configured firm",model_name:null,phase_name:null,profit_target_mode:"AMOUNT",profit_target_value:"100",daily_loss_mode:null,daily_loss_value:null,daily_loss_baseline:null,daily_loss_measure:null,total_loss_mode:null,total_loss_value:null,total_loss_baseline:null,total_loss_measure:null,drawdown_type:"STATIC",consistency_formula:null,consistency_limit_percent:null,minimum_trading_days:null,maximum_trading_days:null,trading_day_timezone:"UTC",trading_day_basis:"OPENED_AT",profitable_day_min_pnl:"0",notes:null,record_version:"1",created_at:stamp,updated_at:stamp};
const fixture=()=>({account,config,timezone:"UTC",goals:[{...fullGoal,goal_type:"ACCOUNT_RETURN_PERCENT",target_value:"10"},{...fullGoal,id:other,goal_type:"MAX_DRAWDOWN_PERCENT",target_value:"20"}],goalEvents:[],statusEvents:[],reviews:[],ruleReviews:[],ruleItems:[],setups:[],instruments:[{id,symbol:"EURUSD"}],classifications:[],snapshots:[],adjustments:[{id,user_id:id,account_id:id,type:"DEPOSIT",amount:"1000",occurred_at:"2026-10-02T00:00:00Z",is_performance_neutral:true},{id:other,user_id:id,account_id:id,type:"WITHDRAWAL",amount:"-100",occurred_at:"2026-10-05T00:00:00Z",is_performance_neutral:true}],trades:[{id,instrument_id:id,status:"CLOSED",opened_at:"2026-10-01T12:00:00Z",closed_at:"2026-10-03T00:00:00Z",net_pnl:"100",actual_r:"1",planned_risk_amount:"100",setup_id:null},{id:other,instrument_id:id,status:"CLOSED",opened_at:"2026-10-04T00:00:00Z",closed_at:"2026-10-04T12:00:00Z",net_pnl:"-50",actual_r:null,planned_risk_amount:null,setup_id:null}]});
describe("shared progress calculation",()=>{
  it("separates trading return and target progress from cash-inclusive balance",()=>{const value=buildProgressDataset(fixture(),stamp);expect(value.currentBalance).toBe("1950.00");expect(value.netProfit).toBe("50.00");expect(value.profitTarget).toMatchObject({current:"50.00",percentage:"50.00"});expect(value.goals[0].currentValue).toBe("5.0000");expect(value.rSample).toBe(1);});
  it("uses cash-neutral amount and the corresponding high-water percentage",()=>{const value=buildProgressDataset(fixture(),stamp);expect(value.maximumDrawdown).toBe("50.00");expect(value.maximumDrawdownPercentage).toBe("2.3810");expect(value.goals[1]).toMatchObject({currentValue:"2.3810",isMaximumLimit:true,withinLimit:true});});
  it("withholds drawdown for unclassified OTHER",()=>{const value=fixture();value.adjustments[0]={...value.adjustments[0],type:"OTHER",is_performance_neutral:null as unknown as boolean};expect(buildProgressDataset(value,stamp)).toMatchObject({maximumDrawdown:null,maximumDrawdownPercentage:null});});
  it("withholds authoritative historical drawdown when closure placement is missing",()=>{const value=fixture();value.trades[1].closed_at=null as unknown as string;expect(buildProgressDataset(value,stamp).maximumDrawdown).toBeNull();});
  it("does not turn placeholder/custom absence into completed evidence",()=>{const value=fixture();value.goals=[{...fullGoal,goal_type:"CUSTOM",custom_unit:"hours"} as unknown as typeof value.goals[0]];expect(buildProgressDataset(value,stamp).goals[0].currentValue).toBeNull();expect(buildProgressDataset(value,stamp).ruleCompliancePercentage).toBeNull();});
  it("requires completed immutable rule snapshots, not placeholder rows or counts alone",()=>{
    const value={...fixture(),ruleReviews:[{id,trade_id:id,applicable_rule_count:2,reviewed_at:stamp}],ruleItems:[{review_id:id,rule_id_snapshot:id,complied:true},{review_id:id,rule_id_snapshot:id,complied:true}]};
    expect(buildProgressDataset(value,stamp).ruleCompliancePercentage).toBeNull();
    value.ruleItems[1].rule_id_snapshot=other;
    expect(buildProgressDataset(value,stamp).ruleCompliancePercentage).toBe("100.00");
    expect(buildProgressDataset({...value,ruleReviews:[{...value.ruleReviews[0],reviewed_at:null}]},stamp).ruleCompliancePercentage).toBeNull();
    value.ruleItems[1].complied=false;
    expect(buildProgressDataset(value,stamp).ruleCompliancePercentage).toBe("0.00");
  });
  it("excludes open results and missing-risk R without manufacturing zeros",()=>{
    const value=fixture();value.trades.push({...value.trades[0],status:"OPEN",closed_at:null as unknown as string,net_pnl:"99999",actual_r:"999",planned_risk_amount:"100"});
    expect(buildProgressDataset(value,stamp)).toMatchObject({closedTrades:2,netProfit:"50.00",cumulativeR:"1.00000000",rSample:1});
    value.trades[0].planned_risk_amount="0";
    value.goals=[{...fullGoal,goal_type:"CUMULATIVE_R",target_value:"10"}];
    expect(buildProgressDataset(value,stamp)).toMatchObject({rSample:0,goals:[{currentValue:null}]});
  });
  it("calculates the complete history rather than a default thousand-row page",()=>{
    const value=fixture();value.trades=Array.from({length:1001},(_,index)=>({...value.trades[0],id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,net_pnl:"0.01",actual_r:null,planned_risk_amount:null}));
    expect(buildProgressDataset(value,stamp)).toMatchObject({closedTrades:1001,netProfit:"10.01",rSample:0});
  });
  it("refuses to guess trailing mechanics or missing equity",()=>{
    const value={...fixture(),config:{...config,total_loss_mode:"AMOUNT",total_loss_value:"50",total_loss_baseline:"STARTING_BALANCE",total_loss_measure:"EQUITY"}};
    value.adjustments=[];
    expect(buildProgressDataset(value,stamp).maximumLossBuffer).toMatchObject({available:false});
    value.config.drawdown_type="TRAILING";
    expect(buildProgressDataset(value,stamp).maximumLossBuffer).toMatchObject({available:false,reason:expect.stringContaining("not implemented")});
  });
  it("does not invent firm loss-rule treatment for account cash movements",()=>{
    const value={...fixture(),config:{...config,total_loss_mode:"AMOUNT",total_loss_value:"50",total_loss_baseline:"STARTING_BALANCE",total_loss_measure:"BALANCE"}};
    expect(buildProgressDataset(value,stamp).maximumLossBuffer).toMatchObject({available:false,reason:expect.stringContaining("cash-flow handling")});
    expect(buildProgressDataset(value,stamp).maximumDrawdown).toBe("50.00");
  });
  it("serializes tiny custom values and R as exact decimal strings, not exponents",()=>{
    const value={...fixture(),goals:[{...fullGoal,goal_type:"CUSTOM",custom_unit:"hours"}],goalEvents:[{id,user_id:id,goal_id:id,progress_value:"0.00000001",recorded_at:stamp,notes:null,created_at:stamp}]};
    value.trades[0].actual_r="0.00000001";
    const result=progressDatasetResultSchema.parse(buildProgressDataset(value,stamp));
    expect(result.goals[0].currentValue).toBe("0.00000001");expect(result.cumulativeR).toBe("0.00000001");
  });
});
