import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildMt5OnboardingPreview, mt5ConnectionViewSchema, mt5StoredSourceSchema } from "@/domain/mt5/onboarding";
import { mt5IdentitySchema } from "@/domain/mt5/source";
import { mt5SymbolMappingSchema } from "@/domain/mt5/symbol-mapping";
import { verifyDirectBrowser } from "@/services/integrations/grant-management";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getIntegrationConfig } from "@/config/integrations";

export class Mt5OnboardingError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "CHANGED" | "INVALID" | "CONFLICT" = "UNAVAILABLE") { super(`MT5_ONBOARDING_${code}`); }
}
type Client = SupabaseClient<IntegrationDatabase>;
const version = z.string().regex(/^[1-9][0-9]*$/);
const sourcePageSchema = z.object({ connectionId: z.string().uuid(),snapshotToken: z.string().regex(/^[a-f0-9]{64}$/),
  version,identity: mt5IdentitySchema,captureCheckpoint: z.iso.datetime({ offset: true }).nullable(),
  ledgerToken: z.string().regex(/^[a-f0-9]{64}$/),
  account: z.object({ name: z.string(),currencyCode: z.string(),currencyPrecision: z.number().int(),startingBalance: z.string(),ledgerBalance: z.string() }),
  tradeCount: z.number().int().nonnegative(),
  trades: z.array(z.object({ id: z.string().uuid(),symbol: z.string(),direction: z.enum(["BUY","SELL"]),
    openedAt: z.string().nullable(),closedAt: z.string().nullable(),canonicalIdentity: z.string().nullable(),closedNetPnl: z.string().nullable() })),
  events: z.array(mt5StoredSourceSchema),sourceFactCount: z.number().int().nonnegative(),incompleteCollections: z.number().int().nonnegative(),
  symbolMappings:z.array(mt5SymbolMappingSchema).default([]),symbolMappingCount:z.number().int().nonnegative().default(0) });

export async function listMt5Connections(client: Client) {
  await verifyDirectBrowser(client);
  const result = await client.rpc("mt5_list_connections");
  if (result.error) throw new Mt5OnboardingError();
  return z.array(mt5ConnectionViewSchema).parse(result.data);
}

export async function registerMt5Connection(client: Client, input: unknown) {
  await verifyDirectBrowser(client);
  if (!getIntegrationConfig("MT5").enabled) throw new Mt5OnboardingError();
  const data = z.object({ grantId: z.string().uuid(),operationId: z.string().uuid(),identity: mt5IdentitySchema }).parse(input);
  if (data.identity.accountKind !== "DEMO") throw new Mt5OnboardingError("INVALID");
  const result = await client.rpc("mt5_register_connection",{ p_grant_id: data.grantId,p_operation_id: data.operationId,p_identity: data.identity });
  if (result.error) throw new Mt5OnboardingError(result.error.code === "23505" ? "CONFLICT" : "UNAVAILABLE");
  return z.object({ connectionId: z.string().uuid(),version,status: z.literal("ONBOARDING") }).parse(result.data);
}

export async function controlMt5Connection(client: Client, input: unknown) {
  await verifyDirectBrowser(client);
  if (!getIntegrationConfig("MT5").enabled) throw new Mt5OnboardingError();
  const data = z.object({ connectionId: z.string().uuid(),version,operationId: z.string().uuid(),
    action: z.enum(["PAUSE","RESUME"]),reason: z.string().trim().min(8).max(1000) }).parse(input);
  const result = await client.rpc("mt5_set_connection_state",{ p_connection_id: data.connectionId,p_expected_version: data.version,
    p_operation_id: data.operationId,p_action: data.action,p_reason: data.reason });
  if (result.error) throw new Mt5OnboardingError(["40001","23505"].includes(result.error.code) ? "CONFLICT" : "UNAVAILABLE");
  return z.object({ connectionId: z.string().uuid(),version,status: z.enum(["PAUSED","ONBOARDING","ACTIVE"]) }).parse(result.data);
}

export async function getMt5OnboardingSnapshot(client: Client, connectionId: string) {
  z.string().uuid().parse(connectionId);
  const connection = (await listMt5Connections(client)).find(item => item.id === connectionId);
  if (!connection) throw new Mt5OnboardingError();
  const sources: z.infer<typeof mt5StoredSourceSchema>[] = [];
  const existing: z.infer<typeof sourcePageSchema>["trades"] = [];
  const symbolMappings:z.infer<typeof mt5SymbolMappingSchema>[]=[];
  let snapshot: string | null = null;
  let ledgerToken: string | null = null;
  let account: z.infer<typeof sourcePageSchema>["account"] | null = null;
  let total = 0;
  let tradeCount = 0;
  let symbolMappingCount=0;
  let offset = 0;
  do {
    const result = await client.rpc("mt5_browser_source_page",{ p_connection_id: connectionId,p_offset: offset,p_limit: 1000 });
    if (result.error) throw new Mt5OnboardingError();
    const page = sourcePageSchema.parse(result.data);
    if (page.connectionId !== connection.id || page.version !== connection.version || page.captureCheckpoint !== connection.captureCheckpoint
      || (snapshot !== null && snapshot !== page.snapshotToken) || (snapshot !== null && total !== page.sourceFactCount)) throw new Mt5OnboardingError("CHANGED");
    if (ledgerToken !== null && ledgerToken !== page.ledgerToken) throw new Mt5OnboardingError("CHANGED");
    ledgerToken = page.ledgerToken; account = page.account;
    snapshot = page.snapshotToken; total = page.sourceFactCount; tradeCount = page.tradeCount; symbolMappingCount=page.symbolMappingCount;
    if (Math.max(total,tradeCount,symbolMappingCount) > 100_000) throw new Mt5OnboardingError("INVALID"); // Never truncate silently.
    if (!page.events.length && sources.length < total) throw new Mt5OnboardingError("CHANGED");
    sources.push(...page.events);
    if (!page.trades.length && existing.length < tradeCount) throw new Mt5OnboardingError("CHANGED");
    if (!page.symbolMappings.length && symbolMappings.length<symbolMappingCount) throw new Mt5OnboardingError("CHANGED");
    existing.push(...page.trades); symbolMappings.push(...page.symbolMappings); offset += 1000;
  } while (offset < Math.max(total,tradeCount,symbolMappingCount));
  const instruments: { id: string; symbol: string; display_name: string; user_id: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("instruments").select("id,symbol,display_name,user_id").order("id").range(offset,offset+999);
    if (result.error) throw new Mt5OnboardingError();
    instruments.push(...result.data);
    if (result.data.length < 1000) break;
  }
  if (!account || account.currencyCode !== connection.identity.currencyCode
    || account.currencyPrecision !== connection.identity.currencyPrecision) throw new Mt5OnboardingError();
  // Detect account edits while paginating the independent canonical-trade list.
  const final = await client.rpc("mt5_browser_source_page",{ p_connection_id: connectionId,p_offset: 0,p_limit: 1 });
  if (final.error) throw new Mt5OnboardingError();
  const checked = sourcePageSchema.parse(final.data);
  if (checked.snapshotToken !== snapshot || checked.ledgerToken !== ledgerToken || checked.version !== connection.version
    || checked.captureCheckpoint !== connection.captureCheckpoint) throw new Mt5OnboardingError("CHANGED");
  return { connection,account,sources,instruments,symbolMappings,existingTrades: existing,snapshotToken: snapshot!,ledgerToken: ledgerToken! };
}

export async function getMt5OnboardingPreview(client: Client, connectionId: string) {
  const snapshot = await getMt5OnboardingSnapshot(client,connectionId);
  return { connection: snapshot.connection,accountName: snapshot.account.name,snapshotToken: snapshot.snapshotToken,
    ledgerToken: snapshot.ledgerToken,instruments:snapshot.instruments,symbolMappings:snapshot.symbolMappings,preview: buildMt5OnboardingPreview({ ...snapshot,
      startingBalance: snapshot.account.startingBalance,ledgerBalance: snapshot.account.ledgerBalance }) };
}
