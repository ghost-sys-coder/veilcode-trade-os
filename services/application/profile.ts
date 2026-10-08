import "server-only";
import { profileGetSchema, profilePatchSchema, profileRecordSchema, profileResultSchema } from "@/domain/profile/commands";
import { applicationTransaction, type ApplicationContext } from "@/services/application/transaction";

export async function getProfile(context: ApplicationContext, input: unknown = {}) {
  return profileRecordSchema.parse(await applicationTransaction(context, "PROFILE_READ", profileGetSchema.parse(input)));
}
export async function patchProfile(context: ApplicationContext, input: unknown) {
  return profileResultSchema.parse(await applicationTransaction(context, "PROFILE_WRITE", profilePatchSchema.parse(input)));
}
