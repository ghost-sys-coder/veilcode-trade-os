import "server-only";
import {
  configurationGetSchema, configurationListSchema, configurationPageSchema, configurationRecordSchema,
  configurationResultSchema, parseConfigurationCommand,
} from "@/domain/configuration/commands";
import { applicationTransaction, type ApplicationContext } from "@/services/application/transaction";
export { ApplicationWorkflowError, type ApplicationContext } from "@/services/application/transaction";

export async function listConfiguration(context:ApplicationContext,input:unknown) {
  return configurationPageSchema.parse(await applicationTransaction(context,"CONFIGURATION_READ",configurationListSchema.parse(input)));
}
export async function getConfiguration(context:ApplicationContext,input:unknown) {
  return configurationRecordSchema.parse(await applicationTransaction(context,"CONFIGURATION_READ",configurationGetSchema.parse(input)));
}
export async function writeConfiguration(context:ApplicationContext,action:"CREATE"|"PATCH"|"ARCHIVE",input:unknown) {
  return configurationResultSchema.parse(await applicationTransaction(context,"CONFIGURATION_WRITE",parseConfigurationCommand(action,input)));
}
