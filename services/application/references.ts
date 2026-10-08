import "server-only";
import { referenceGetSchema,referenceListSchema,referencePageSchema,referenceRecordSchema,referenceResultSchema,
  parseReferenceCommand,tradeTagsListSchema,tradeTagCommandSchema,tradeTagResultSchema,tagRecordSchema,type ReferenceAction } from "@/domain/references/commands";
import { applicationTransaction,type ApplicationContext } from "@/services/application/transaction";

export async function getReference(context:ApplicationContext,input:unknown) {
  return referenceRecordSchema.parse(await applicationTransaction(context,"REFERENCE_READ",referenceGetSchema.parse(input)));
}
export async function listReferences(context:ApplicationContext,input:unknown) {
  return referencePageSchema.parse(await applicationTransaction(context,"REFERENCE_READ",referenceListSchema.parse(input)));
}
export async function writeReference(context:ApplicationContext,action:ReferenceAction,input:unknown) {
  return referenceResultSchema.parse(await applicationTransaction(context,"REFERENCE_WRITE",parseReferenceCommand(action,input)));
}
export async function listTradeTags(context:ApplicationContext,input:unknown) {
  return referencePageSchema.parse(await applicationTransaction(context,"REFERENCE_READ",{
    ...tradeTagsListSchema.parse(input),entity:"TAG",includeArchived:true,
  }));
}
export async function writeTradeTag(context:ApplicationContext,action:"ASSIGN"|"REMOVE",input:unknown) {
  return tradeTagResultSchema.parse(await applicationTransaction(context,"TRADE_TAG_WRITE",{...tradeTagCommandSchema.parse(input),action}));
}
/** Browser libraries exhaust every bounded page, rather than silently capping at 100. */
export async function listBrowserTags(context:ApplicationContext) {
  const tags:Array<ReturnType<typeof tagRecordSchema.parse>>=[];
  let afterId:string|undefined;
  do {
    const page=await listReferences(context,{entity:"TAG",limit:100,...(afterId?{afterId}:{})});
    tags.push(...page.records.map(record=>tagRecordSchema.parse(record)));
    afterId=page.nextCursor??undefined;
  } while(afterId);
  return tags.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function listBrowserTradeTags(context:ApplicationContext,tradeId:string) {
  const tags:Array<ReturnType<typeof tagRecordSchema.parse>>=[];
  let afterId:string|undefined;
  do {
    const page=await listTradeTags(context,{tradeId,limit:100,...(afterId?{afterId}:{})});
    tags.push(...page.records.map(record=>tagRecordSchema.parse(record)));
    afterId=page.nextCursor??undefined;
  } while(afterId);
  return tags.sort((a,b)=>a.name.localeCompare(b.name));
}
