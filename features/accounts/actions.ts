"use server";

import { revalidatePath } from "next/cache";
import { tradingAccountSchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { writeAccount } from "@/services/application/accounts";
import { configurationFormError } from "@/services/application/form-error";

export async function saveAccount(formData:FormData):Promise<void> {
  const result=tradingAccountSchema.safeParse({id:formData.get("id")??"",name:formData.get("name"),accountType:formData.get("accountType"),
    brokerName:formData.get("brokerName")??"",platform:formData.get("platform"),currencyCode:formData.get("currencyCode"),
    currencyPrecision:formData.get("currencyPrecision"),startingBalance:formData.get("startingBalance"),leverage:formData.get("leverage")??"",
    startedAt:formData.get("startedAt"),status:formData.get("status"),notes:formData.get("notes")??""});
  if(!result.success)redirectWithStatus("/accounts","error",firstValidationError(result.error));
  const value=result.data;
  const reason=String(formData.get("correctionReason")??"").trim();
  try {
    const context=await getVerifiedBrowserContext(await createClient());
    await writeAccount(context,value.id?"PATCH":"CREATE",{operationId:formData.get("operationId"),
      ...(value.id?{id:value.id,expectedVersion:formData.get("expectedVersion"),...(reason?{reason}:{})}:{}),
      values:{name:value.name,account_type:value.accountType,broker_name:value.brokerName??null,platform:value.platform,
        currency_code:value.currencyCode,currency_precision:value.currencyPrecision,starting_balance:value.startingBalance,
        leverage:value.leverage??null,started_at:value.startedAt,notes:value.notes??null,...(value.id?{}:{status:value.status})}});
  } catch(error) {redirectWithStatus("/accounts","error",configurationFormError(error));}
  revalidatePath("/accounts");revalidatePath("/dashboard");revalidatePath("/analytics","layout");
  if(value.id)revalidatePath(`/accounts/${value.id}`);
  redirectWithStatus("/accounts","message",value.id?"Account updated.":"Account created.");
}
