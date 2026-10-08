import { afterEach, describe, expect, it, vi } from "vitest";
import { profileGetSchema, profilePatchSchema, profileRecordSchema } from "@/domain/profile/commands";
import { getProfile, patchProfile } from "@/services/application/profile";
import { ApplicationWorkflowError, type ApplicationContext } from "@/services/application/transaction";
const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/services/application/transaction", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/application/transaction")>(), applicationTransaction: transaction,
}));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", context = { userId: id } as ApplicationContext;
const record = { id, display_name: "Trader", timezone: "Africa/Kampala", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-09T00:00:00Z", record_version: "1" };
const command = { operationId: id, expectedVersion: "1", values: { displayName: "New name" } };
afterEach(() => vi.resetAllMocks());
describe("self-profile command contract", () => {
  it.each([{ id }, { ownerId: id }, { user_id: id }, { email: "x@example.test" }, null])("cannot choose a profile or auth data %j", input => expect(profileGetSchema.safeParse(input).success).toBe(false));
  it.each([{ values: {} }, { values: { displayName: undefined } }, { values: { email: "x@example.test" } }, { values: { password: "fixture-not-secret" } }, { values: { user_id: id } }, { values: { currency_code: "USD" } }, { values: { displayName: "A" } }, { values: { displayName: "😀" } }, { values: { displayName: " " } }, { values: { displayName: "a".repeat(81) } }, { values: { timezone: null } }, { values: { timezone: "invalid/zone" } }, { expectedVersion: 1 }, { expectedVersion: "0" }, { expectedVersion: "9223372036854775808" }, { id }])("rejects protected/invalid patch %j", input => {
    expect(profilePatchSchema.safeParse({ ...command, ...input }).success).toBe(false);
  });
  it("preserves omitted fields and allows only explicit display-name clearing", () => {
    expect(profilePatchSchema.parse({ ...command, values: { displayName: null } }).values).toEqual({ displayName: null });
    expect(profilePatchSchema.parse({ ...command, values: { timezone: " utc " } }).values).toEqual({ timezone: "UTC" });
    expect(profilePatchSchema.parse({ ...command, values: { displayName: "  😀😀  " } }).values.displayName).toBe("😀😀");
    expect(profilePatchSchema.parse({ ...command, values: { displayName: "😀".repeat(80) } }).values.displayName).toHaveLength(160);
  });
  it("canonicalizes valid case-insensitive timezone names without rewriting timestamps", () => {
    expect(profilePatchSchema.parse({ ...command, values: { timezone: "europe/london" } }).values.timezone).toBe("Europe/London");
    expect(profileRecordSchema.parse({ ...record, display_name: "X" })).toEqual({ ...record, display_name: "X" });
  });
  it("rejects unexpected auth fields and unsafe wire versions", () => {
    expect(profileRecordSchema.safeParse({ ...record, email: "private@example.test" }).success).toBe(false);
    expect(profileRecordSchema.safeParse({ ...record, record_version: 1 }).success).toBe(false);
    expect(profileRecordSchema.safeParse({ ...record, record_version: "9007199254740993" }).success).toBe(true);
  });
  it("does not open a private workflow for a forged scope", async () => {
    await expect(getProfile(context, { id })).rejects.toThrow();
    await expect(patchProfile(context, { ...command, ownerId: id })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("uses verified context and fixed ownerless workflows, validating outputs", async () => {
    transaction.mockResolvedValue(record);
    expect(await getProfile(context)).toEqual(record);
    expect(transaction).toHaveBeenLastCalledWith(context, "PROFILE_READ", {});
    transaction.mockResolvedValue({ action: "PATCH", record });
    expect(await patchProfile(context, command)).toEqual({ action: "PATCH", record });
    expect(transaction).toHaveBeenLastCalledWith(context, "PROFILE_WRITE", command);
    transaction.mockResolvedValue({ ...record, record_version: 1 });
    await expect(getProfile(context)).rejects.toThrow();
  });
  it.each(["ACCESS_DENIED", "VERSION_CONFLICT", "OPERATION_CONFLICT", "READ_UNAVAILABLE"] as const)("propagates %s without a stale or weaker fallback", async code => {
    transaction.mockRejectedValue(new ApplicationWorkflowError(code));
    await expect(patchProfile(context, command)).rejects.toMatchObject({ code });
    expect(transaction).toHaveBeenCalledOnce();
  });
});
