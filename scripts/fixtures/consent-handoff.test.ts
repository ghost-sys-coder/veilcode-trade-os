import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { databaseTestConnection } from "../lib/database-test-safety.mjs";
import { mcpConsentHandoff } from "@/services/integrations/consent-handoff";
import type { IntegrationDatabase } from "@/types/integration-database";

const destination = "https://consent-handoff.example.test";
const resource = `${destination}/mcp`;
const callback = "http://127.0.0.1:9879/callback";
let database: pg.Client | undefined;
let admin: ReturnType<typeof createClient> | undefined;
let browser: SupabaseClient<IntegrationDatabase>;
let issuer: string, userId: string | undefined, clientId: string | undefined;
let previous: { resource: string; enabled: boolean } | undefined;
let locked = false, changed = false;

beforeAll(async () => {
  // No .env, remote fallback, real user credentials, model or MT5 terminal.
  const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000,
  }));
  const api = new URL(status.API_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)) throw Error("Disposable local API required");
  database = new pg.Client({ ...databaseTestConnection(status.DB_URL), statement_timeout: 180000 });
  database.on("error", () => { /* Safe timeout/cleanup failures are asserted below. */ });
  await database.connect();
  // These fixtures share resource configuration with the browser/MCP gates.
  // Fail immediately if another gate owns it; never time out mid-preparation.
  const lease = await database.query("select pg_try_advisory_lock(670051234) as acquired");
  if (!lease.rows[0].acquired) throw Error("Run disposable provider gates sequentially; another fixture is active");
  locked = true;
  previous = (await database.query("select resource,enabled from private.integration_resources where purpose='MCP'")).rows[0];
  await database.query("insert into private.integration_resources(purpose,resource,enabled) values('MCP',$1,true) on conflict(purpose) do update set resource=excluded.resource,enabled=true", [resource]); changed = true;
  issuer = `${api.origin}/auth/v1`;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  admin = createClient(api.origin, status.SERVICE_ROLE_KEY, options);
  browser = createClient<IntegrationDatabase>(api.origin, status.ANON_KEY, options);
  const password = randomBytes(32).toString("base64url");
  const email = `handoff-${randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw Error("Disposable identity preparation failed");
  userId = user.data.user.id;
  const login = await browser.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw Error("Disposable browser sign-in failed");
  const client = await admin.auth.admin.oauth.createClient({ client_name: "Disposable consent handoff fixture",
    redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  if (client.error || !client.data) throw Error("Disposable public client preparation failed");
  clientId = client.data.client_id;
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", "https://consent-host.example.test");
  vi.stubEnv("TRADE_OS_MCP_ENABLED", "false");
  vi.stubEnv("TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN", destination);
});

async function freshRequest(target = resource, method = "S256") {
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL(`${issuer}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: clientId!, redirect_uri: callback, response_type: "code", scope: "email",
    state: randomUUID(), resource: target, code_challenge_method: method,
    code_challenge: method === "S256" ? createHash("sha256").update(verifier).digest("base64url") : verifier }).toString();
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const location = response.headers.get("location");
  if (![302, 303, 307].includes(response.status) || !location) throw Error("Disposable authorization preparation failed");
  const id = new URL(location).searchParams.get("authorization_id");
  if (!id) throw Error("Disposable request ID unavailable");
  return id;
}

describe("real provider first-visit MCP handoff", () => {
  it("binds an initially unowned request and routes on the FIRST call, without approving", async () => {
    const id = await freshRequest();
    const before = (await database!.query("select user_id is null as unbound from auth.oauth_authorizations where authorization_id=$1", [id])).rows[0];
    expect(before.unbound).toBe(true);
    const target = await mcpConsentHandoff(browser, id);
    expect(target !== null && new URL(target).origin === destination && new URL(target).searchParams.get("authorization_id") === id).toBe(true);
    const after = (await database!.query("select user_id=$2::uuid as owned,status::text from auth.oauth_authorizations where authorization_id=$1", [id, userId])).rows[0];
    expect(after.owned).toBe(true); expect(after.status).toBe("pending");
    expect((await database!.query("select count(*)::text as n from private.integration_grants where client_id=$1", [clientId])).rows[0].n).toBe("0");
    expect(process.env.TRADE_OS_MCP_ENABLED).toBe("false");
  });
  it("does not weaken S256 enforcement after normal provider ownership binding", async () => {
    expect(await mcpConsentHandoff(browser, await freshRequest(resource, "plain"))).toBeNull();
  });
  it("does not route an unknown resource after provider binding", async () => {
    expect(await mcpConsentHandoff(browser, await freshRequest("https://wrong-resource.example.test/mcp"))).toBeNull();
  });
  it("rechecks expiry even when the request is already owned", async () => {
    const id = await freshRequest();
    expect(await mcpConsentHandoff(browser, id) !== null).toBe(true);
    // Respect the provider's future-expiry constraint, then let the real clock
    // cross it; do not disable constraints or forge an already-expired insert.
    await database!.query("update auth.oauth_authorizations set expires_at=clock_timestamp()+interval '200 milliseconds' where authorization_id=$1", [id]);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(await mcpConsentHandoff(browser, id)).toBeNull();
  });
  it("routes first-visit reconnect after provider consent without forwarding a resume code or granting access", async () => {
    const initial = await freshRequest();
    expect(await mcpConsentHandoff(browser, initial) !== null).toBe(true);
    const approved = await browser.auth.oauth.approveAuthorization(initial, { skipBrowserRedirect: true });
    if (approved.error || !approved.data) throw Error("Disposable provider consent failed");
    const reconnect = await freshRequest();
    expect((await database!.query("select user_id is null as unbound from auth.oauth_authorizations where authorization_id=$1", [reconnect])).rows[0].unbound).toBe(true);
    const target = await mcpConsentHandoff(browser, reconnect);
    expect(target !== null && new URL(target).origin === destination && new URL(target).searchParams.get("authorization_id") === reconnect).toBe(true);
    expect(target?.includes("code=")).toBe(false);
    expect((await database!.query("select count(*)::text as n from private.integration_grants where client_id=$1", [clientId])).rows[0].n).toBe("0");
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  let cleanupFailed = false;
  try {
    if (clientId && admin) { const deleted = await admin.auth.admin.oauth.deleteClient(clientId); if (deleted.error) cleanupFailed = true; }
  } catch { cleanupFailed = true; }
  try {
    if (userId && admin) { const deleted = await admin.auth.admin.deleteUser(userId); if (deleted.error) cleanupFailed = true; }
  } catch { cleanupFailed = true; }
  try {
    if (changed && database) {
      if (previous) await database.query("update private.integration_resources set resource=$1,enabled=$2 where purpose='MCP'", [previous.resource, previous.enabled]);
      else await database.query("delete from private.integration_resources where purpose='MCP'");
    }
    if (locked && database) await database.query("select pg_advisory_unlock(670051234)");
  } catch { cleanupFailed = true; }
  finally { await database?.end(); }
  if (cleanupFailed) throw Error("Disposable consent fixture cleanup requires attention; private details suppressed");
});
