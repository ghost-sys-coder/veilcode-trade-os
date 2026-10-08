import { z } from "zod";
import { recordVersionSchema } from "@/domain/configuration/commands";
import { profileSettingsSchema } from "@/domain/validation/schemas";

// Count Unicode characters, not UTF-16 units, consistently with PostgreSQL.
export const profileDisplayNameSchema = z.string().trim().min(2).max(160)
  .refine(value => [...value].length >= 2 && [...value].length <= 80, "Display name must contain 2–80 characters.").nullable();
export const profileTimezoneSchema = profileSettingsSchema.shape.timezone.transform(value =>
  new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone);
export const profileGetSchema = z.object({}).strict();
export const profilePatchSchema = z.object({
  operationId: z.string().uuid(), expectedVersion: recordVersionSchema,
  values: z.object({ displayName: profileDisplayNameSchema.optional(), timezone: profileTimezoneSchema.optional() }).strict()
    .refine(value => Object.values(value).some(field => field !== undefined), "A profile patch needs at least one preference."),
}).strict();
/** Read existing display names without truncating legacy friendly forms. */
export const profileRecordSchema = z.object({
  id: z.string().uuid(), display_name: z.string().nullable(), timezone: profileSettingsSchema.shape.timezone,
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }), record_version: recordVersionSchema,
}).strict();
export const profileResultSchema = z.object({ action: z.literal("PATCH"), record: profileRecordSchema }).strict();
