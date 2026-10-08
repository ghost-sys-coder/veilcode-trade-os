import "server-only";
import { accountEventCommand,accountEventListSchema,eventPageSchema,eventResultSchema,prepareAccountEvent } from "@/domain/accounts/events";
import { applicationTransaction,type ApplicationContext } from "@/services/application/transaction";

export async function writeAccountEvent(context:ApplicationContext,action:ReturnType<typeof eventResultSchema.parse>["action"],input:unknown) {
  const request=accountEventCommand(action,input);
  return eventResultSchema.parse(await applicationTransaction(context,"ACCOUNT_EVENT_WRITE",request,snapshot=>prepareAccountEvent(request,snapshot)));
}
export async function listAccountEvents(context:ApplicationContext,input:unknown) {
  return eventPageSchema.parse(await applicationTransaction(context,"ACCOUNT_EVENT_READ",accountEventListSchema.parse(input)));
}
