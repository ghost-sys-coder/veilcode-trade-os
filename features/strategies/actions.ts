"use server";

import { revalidatePath } from "next/cache";
import { setupSchema, strategySchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { writeConfiguration } from "@/services/application/configuration";
import { configurationFormError } from "@/services/application/form-error";

async function persist(formData:FormData,entity:"STRATEGY"|"SETUP",id:string|undefined,values:object) {
  try {
    const context=await getVerifiedBrowserContext(await createClient());
    await writeConfiguration(context,id?"PATCH":"CREATE",{
      entity,operationId:formData.get("operationId"),values,
      ...(id?{id,expectedVersion:formData.get("expectedVersion")}:{}),
    });
  } catch(error) {redirectWithStatus("/strategies","error",configurationFormError(error));}
  revalidatePath("/strategies");
  revalidatePath("/dashboard");
  redirectWithStatus("/strategies","message",`${entity==="STRATEGY"?"Strategy":"Setup"} ${id?"updated":"created"}.`);
}

export async function saveStrategy(formData:FormData):Promise<void> {
  const result=strategySchema.safeParse({id:formData.get("id")??"",name:formData.get("name"),
    description:formData.get("description")??"",active:formData.get("active")==="on"});
  if(!result.success)redirectWithStatus("/strategies","error",firstValidationError(result.error));
  const values=result.data;
  await persist(formData,"STRATEGY",values.id,{name:values.name,description:values.description??null,active:values.active});
}

export async function saveSetup(formData:FormData):Promise<void> {
  const result=setupSchema.safeParse({id:formData.get("id")??"",strategyId:formData.get("strategyId"),
    name:formData.get("name"),description:formData.get("description")??"",active:formData.get("active")==="on"});
  if(!result.success)redirectWithStatus("/strategies","error",firstValidationError(result.error));
  const values=result.data;
  await persist(formData,"SETUP",values.id,{name:values.name,description:values.description??null,active:values.active,strategy_id:values.strategyId});
}
