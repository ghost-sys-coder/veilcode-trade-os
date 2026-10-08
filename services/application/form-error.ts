import { ZodError } from "zod";
import { ApplicationWorkflowError } from "@/services/application/configuration";

/** No raw PG/credentials or unexpected exception messages reach a redirect. */
export function configurationFormError(error:unknown):string {
  if(error instanceof ApplicationWorkflowError)return error.message;
  if(error instanceof ZodError)return error.issues[0]?.message??"Invalid configuration values.";
  return "Unable to save this record. Reload and check your session before trying again.";
}
