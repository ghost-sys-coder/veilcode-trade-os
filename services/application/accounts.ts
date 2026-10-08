import "server-only";
import { z } from "zod";
import { accountCreateSchema, accountGetSchema, accountListSchema, accountPatchSchema, accountRecordSchema,
  accountResultSchema, accountWithBalance } from "@/domain/accounts/commands";
import { applicationTransaction, type ApplicationContext } from "@/services/application/transaction";

const rawPage=z.object({records:z.array(accountRecordSchema),nextCursor:z.string().uuid().nullable()}).strict();
export async function listAccounts(context:ApplicationContext,input:unknown) {
  const page=rawPage.parse(await applicationTransaction(context,"ACCOUNT_READ",accountListSchema.parse(input)));
  return {...page,records:page.records.map(accountWithBalance)};
}
export async function getAccount(context:ApplicationContext,input:unknown) {
  return accountWithBalance(await applicationTransaction(context,"ACCOUNT_READ",accountGetSchema.parse(input)));
}
export async function getAccountLedgerRecords(context:ApplicationContext,input:unknown) {
  return z.object({account:accountRecordSchema,trades:z.array(z.record(z.string(),z.unknown())),adjustments:z.array(z.record(z.string(),z.unknown())),
    snapshots:z.array(z.record(z.string(),z.unknown())),classifications:z.array(z.record(z.string(),z.unknown())),instruments:z.array(z.object({id:z.string().uuid(),symbol:z.string()}))})
    .parse(await applicationTransaction(context,"ACCOUNT_LEDGER",accountGetSchema.parse(input)));
}
/** Browser register exhausts bounded pages; MCP clients paginate explicitly. */
export async function listBrowserAccounts(context:ApplicationContext) {
  if("actor" in context)throw new Error("Direct browser register required.");
  const accounts:Array<ReturnType<typeof accountWithBalance>>=[];
  let afterId:string|undefined;
  do {
    const page=await listAccounts(context,{limit:100,...(afterId?{afterId}:{})});
    accounts.push(...page.records);
    if(page.nextCursor!==null && page.nextCursor===afterId)throw new Error("Account cursor did not advance.");
    afterId=page.nextCursor??undefined;
  } while(afterId);
  return accounts.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id));
}
export async function writeAccount(context:ApplicationContext,action:"CREATE"|"PATCH",input:unknown) {
  const request=action==="CREATE"?accountCreateSchema.parse(input):accountPatchSchema.parse(input);
  const result=z.object({action:z.enum(["CREATE","PATCH"]),record:accountRecordSchema}).strict()
    .parse(await applicationTransaction(context,"ACCOUNT_WRITE",{...request,action}));
  return accountResultSchema.parse({...result,record:accountWithBalance(result.record)});
}
