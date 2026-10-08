"use server";

import { revalidatePath } from "next/cache";
import { tradingRuleSchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { writeConfiguration } from "@/services/application/configuration";
import { configurationFormError } from "@/services/application/form-error";

export async function saveTradingRule(formData:FormData):Promise<void> {
  const result=tradingRuleSchema.safeParse({id:formData.get("id")??"",
    accountId:formData.get("accountId")==="ALL"?"":formData.get("accountId")??"",
    name:formData.get("name"),description:formData.get("description"),ruleType:formData.get("ruleType"),
    numericLimit:formData.get("numericLimit")??"",active:formData.get("active")==="on"});
  if(!result.success)redirectWithStatus("/rules","error",firstValidationError(result.error));
  const values=result.data;
  try {
    const context=await getVerifiedBrowserContext(await createClient());
    await writeConfiguration(context,values.id?"PATCH":"CREATE",{entity:"RULE",operationId:formData.get("operationId"),
      ...(values.id?{id:values.id,expectedVersion:formData.get("expectedVersion")}:{}),
      values:{name:values.name,description:values.description,active:values.active,account_id:values.accountId??null,
        rule_type:values.ruleType,numeric_limit:values.numericLimit??null}});
  } catch(error) {redirectWithStatus("/rules","error",configurationFormError(error));}
  revalidatePath("/rules");
  revalidatePath("/dashboard");
  redirectWithStatus("/rules","message",values.id?"Trading rule updated.":"Trading rule created.");
}
