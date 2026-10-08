import "server-only";
import {applicationTransaction,type ApplicationContext} from "@/services/application/transaction";
import {goalGetSchema,goalListSchema,goalProgressListSchema,goalRecordSchema,goalPageSchema,goalEventPageSchema,propGetSchema,propResultSchema,progressCommand,prepareProgress,progressResultSchema,type ProgressAction} from "@/domain/progress/commands";
import {buildProgressDataset,progressDatasetResultSchema} from "@/domain/progress/dataset";
export async function getGoal(context:ApplicationContext,input:unknown) {return goalRecordSchema.parse(await applicationTransaction(context,"PROGRESS_READ",{...goalGetSchema.parse(input),kind:"GOAL"}));}
export async function listGoals(context:ApplicationContext,input:unknown) {return goalPageSchema.parse(await applicationTransaction(context,"PROGRESS_READ",{...goalListSchema.parse(input),kind:"GOALS"}));}
export async function listGoalProgress(context:ApplicationContext,input:unknown) {return goalEventPageSchema.parse(await applicationTransaction(context,"PROGRESS_READ",{...goalProgressListSchema.parse(input),kind:"EVENTS"}));}
export async function getPropConfig(context:ApplicationContext,input:unknown) {return propResultSchema.parse(await applicationTransaction(context,"PROGRESS_READ",{...propGetSchema.parse(input),kind:"PROP"}));}
export async function writeProgress(context:ApplicationContext,action:ProgressAction,input:unknown) {
  const request=progressCommand(action,input);
  return progressResultSchema.parse(await applicationTransaction(context,"PROGRESS_WRITE",request,source=>prepareProgress(request,source)));
}
export async function getAccountProgress(context:ApplicationContext,input:unknown) {
  return progressDatasetResultSchema.parse(buildProgressDataset(await applicationTransaction(context,"PROGRESS_DATA",propGetSchema.parse(input))));
}
