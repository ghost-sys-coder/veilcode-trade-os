import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { databaseTestConnection } from "../lib/database-test-safety.mjs";
import { createSetupProfile, listSetupProfiles, reconcileSetupProfile } from "@/services/integrations/setup-profiles";
import { setupClientName, setupProfileSchema } from "@/domain/integrations/setup";
import type { IntegrationDatabase } from "@/types/integration-database";
import { companionDistribution } from "@/domain/integrations/companion-distribution";

const origin = "http://127.0.0.1:3100";
let db: pg.Client | undefined, admin: ReturnType<typeof createClient> | undefined;
let client: SupabaseClient<IntegrationDatabase>, ui: Browser | undefined, page: Page;
let owner: string | undefined, account: string, email: string, password: string;
let locked = false, schemaCreated = false, changed = false, diagnosticHintsChanged = false;
let pairingSchemaCreated = false;
let previousResources: { purpose: string; resource: string; enabled: boolean }[] = [];
let previousPolicies: { purpose: string; enabled: boolean }[] = [];
let previousRpcDefinitions: string[] = [];
const browserErrors: string[] = [];
function localDiagnosticHints(action: "disable" | "restore") {
  const query = (sql: string) => execFileSync("docker", ["exec", "supabase_db_trade-os", "sh", "-c",
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -Atc "$1"', "sh",
    sql],
  { stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
  try {
    query(action === "disable" ? "alter system set supautils.hint_roles='';" : "alter system reset supautils.hint_roles;");
    if (action === "disable") diagnosticHintsChanged = true;
    query("select pg_reload_conf();");
  } catch { throw Error("Disposable diagnostic helper failed; details suppressed"); }
}
const requestOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
    return response;
  } } };

beforeAll(async () => {
  const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000,
  }));
  const api = new URL(status.API_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)) throw Error("Disposable loopback API required");
  db = new pg.Client({ ...databaseTestConnection(status.DB_URL), statement_timeout: 120000 });
  db.on("error", () => {}); await db.connect();
  locked = (await db.query("select pg_try_advisory_lock(670051234) as acquired")).rows[0].acquired;
  if (!locked) throw Error("Run local provider gates sequentially");
  // Stock local Supautils crashes while formatting intentional denial hints.
  // Disable diagnostic hints only, not privileges, and restore on every exit.
  const hints = (await db.query("select setting,sourcefile from pg_settings where name='supautils.hint_roles'")).rows[0];
  if (hints?.setting !== 'anon, authenticated, service_role' || hints.sourcefile?.includes('postgresql.auto.conf'))
    throw Error("Unexpected disposable diagnostic configuration; no change performed");
  localDiagnosticHints("disable");
  const present = (await db.query("select to_regclass('private.integration_setup_profiles') as relation")).rows[0].relation;
  if (!present) {
    previousRpcDefinitions = (await db.query(`select pg_get_functiondef(name::regprocedure) as definition from unnest(array[
      'private.revoke_integration_grant(uuid,text)','private.activate_integration_grant(text,text)',
      'private.application_mt5_set_connection_state_impl(uuid,text,uuid,text,text)']) name`)).rows.map(row => row.definition);
    await db.query("begin");
    try { await db.query(await readFile("supabase/migrations/20261013023636_integration_setup_profiles.sql", "utf8")); await db.query("commit"); schemaCreated = true; }
    catch(error) { await db.query("rollback"); throw Error(`Disposable setup schema preparation failed (${error instanceof Error ? error.message.slice(0, 150) : "unknown"})`); }
  }
  if (!(await db.query("select to_regclass('private.mt5_setup_pairings') as relation")).rows[0].relation) {
    await db.query("begin");
    try { await db.query(await readFile("supabase/migrations/20261013023643_mt5_companion_pairing.sql", "utf8")); await db.query("commit"); pairingSchemaCreated = true; }
    catch { await db.query("rollback"); throw Error("Disposable pairing schema preparation failed"); }
  }
  previousResources = (await db.query("select purpose,resource,enabled from private.integration_resources")).rows;
  previousPolicies = (await db.query("select purpose,enabled from private.integration_setup_policies")).rows;
  await db.query("insert into private.integration_resources(purpose,resource,enabled) values('MCP',$1,true),('MT5',$2,true) on conflict(purpose) do update set resource=excluded.resource,enabled=true", [`${origin}/mcp`, `${origin}/api/integrations/v1`]);
  changed = true;
  await db.query("insert into private.integration_setup_policies(purpose,enabled) values('MCP',true),('MT5',true) on conflict(purpose) do update set enabled=true");
  try {
    const preflight = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/check-application-database.mts", "--local"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
        env: { ...process.env, TRADE_OS_INTEGRATION_SETUP_ENABLED: "true" } });
    expect(preflight).toContain("Application database preflight PASS: 46 functions and 14 version/order columns.");
  } catch { throw Error("Enabled disposable setup database preflight failed; details suppressed"); }
  const options = requestOptions;
  admin = createClient(api.origin, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, options);
  client = createClient<IntegrationDatabase>(api.origin, status.ANON_KEY, options);
  email = `setup-${randomUUID()}@example.test`; password = randomBytes(32).toString("base64url");
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw Error("Disposable setup user preparation failed");
  owner = user.data.user.id; account = randomUUID();
  await db.query("insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance) values($1,$2,'Setup USD demo','DEMO','MT5','USD',2,100000)", [account, owner]);
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw Error("Disposable direct browser sign-in failed");
  vi.stubEnv("TRADE_OS_LOCAL_TEST_APP", "true"); vi.stubEnv("TRADE_OS_INTEGRATION_SETUP_ENABLED", "true");
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", origin); vi.stubEnv("TRADE_OS_MT5_ENABLED", "true"); vi.stubEnv("TRADE_OS_MCP_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", api.origin); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", status.ANON_KEY);
  vi.stubEnv("SUPABASE_SECRET_KEY", status.SECRET_KEY ?? status.SERVICE_ROLE_KEY);
  ui = await chromium.launch({ channel: "chrome", headless: true });
  console.info(`Setup browser: Chrome ${ui.version()}`);
  page = await ui.newPage();
  page.on("pageerror", error => browserErrors.push(error.name));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("favicon")) {
    const safe = message.text().replaceAll(password, "[redacted]").replaceAll(email, "[redacted]")
      .replace(/https?:\/\/\S+/g, "[url]").replace(/eyJ[A-Za-z0-9._-]+/g, "[token]");
    browserErrors.push(safe.slice(0, 4000));
  } });
  await page.goto(`${origin}/login?next=${encodeURIComponent("/settings/integrations")}`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`${origin}/settings/integrations`);
}, 120000);

describe("disposable app-led setup provider and browser gate", () => {
  it("concurrent real provider reservations create one public client and no grant", async () => {
    const operationId = randomUUID();
    const input = { operationId, clientKind: "CODEX", accountId: null };
    // Independent requests use independent SDK auth locks, as real browser requests do.
    const session = await client.auth.getSession();
    const concurrentClient = createClient<IntegrationDatabase>(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, requestOptions);
    if (!session.data.session || (await concurrentClient.auth.setSession(session.data.session)).error) throw Error("Disposable concurrent session preparation failed");
    const results = await Promise.all([createSetupProfile(client, input), createSetupProfile(concurrentClient, input)]);
    expect(new Set(results.map(row => row.id)).size).toBe(1);
    const latest = (await listSetupProfiles(client)).find(row => row.id === results[0].id)!;
    const checked = await reconcileSetupProfile(client, { id: latest.id, version: latest.version });
    expect(checked.status).toBe("READY");
    expect((await db!.query("select count(*)::int as count from auth.oauth_clients where client_name=$1", [setupClientName(checked)])).rows[0].count).toBe(1);
    expect((await db!.query("select count(*)::int as count from private.integration_grants where owner_id=$1", [owner])).rows[0].count).toBe(0);
    expect((await createSetupProfile(client, input)).id).toBe(checked.id);
    const conflict = await client.rpc("reserve_integration_setup", { p_operation_id: operationId,
      p_client_kind: "CLAUDE_CODE", p_account_id: null, p_resource: `${origin}/mcp` });
    expect(conflict.error?.code).toBe("PT409");
    const stale = await client.rpc("reconcile_integration_setup", { p_profile_id: checked.id, p_expected_version: "1" });
    expect(stale.error?.code).toBe("PT409");
  });
  it("recovers a committed provider record without replaying creation", async () => {
    const operationId = randomUUID();
    const reserved = await client.rpc("reserve_integration_setup", { p_operation_id: operationId,
      p_client_kind: "CLAUDE_CODE", p_account_id: null, p_resource: `${origin}/mcp` });
    if (reserved.error) throw Error("Disposable reservation failed");
    const { createAllowed, ...fields } = reserved.data as Record<string, unknown>;
    expect(createAllowed).toBe(true);
    const profile = setupProfileSchema.parse(fields);
    const created = await admin!.auth.admin.oauth.createClient({ client_name: setupClientName(profile),
      redirect_uris: [profile.callbackUri], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    if (created.error) throw Error("Disposable public provider client creation failed");
    const result = await createSetupProfile(client, { operationId, clientKind: "CLAUDE_CODE", accountId: null });
    expect(result.status).toBe("READY");
    expect((await db!.query("select count(*)::int as count from auth.oauth_clients where client_name=$1", [setupClientName(profile)])).rows[0].count).toBe(1);
  });
  it("prepares a client through the real UI and downloads only public adapter metadata", async () => {
    await page.goto(`${origin}/settings/integrations/connect/mcp`);
    await page.getByLabel("Integration client", { exact: true }).selectOption("GEMINI_CLI");
    await browserExpect(page.getByRole("button", { name: "Prepare connection setup", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Prepare connection setup", exact: true }).click();
    await page.getByRole("link", { name: "Continue saved setup →", exact: true }).click();
    await page.waitForURL(/\/settings\/integrations\/setup\/[0-9a-f-]{36}$/);
    await browserExpect(page.getByRole("heading", { name: "Gemini CLI setup", exact: true })).toBeVisible();
    const distribution = companionDistribution(process.env);
    if (distribution) {
      await browserExpect(page.getByRole("button", {name: "Download Windows companion preview", exact: true})).toHaveAttribute("href", distribution.url);
      await browserExpect(page.getByText("Unsigned Windows 10/11 x64 preview", {exact: false})).toBeVisible();
      await browserExpect(page.getByText("SHA-256: " + distribution.sha256, {exact: false})).toBeVisible();
      for (const theme of ["light", "dark"]) {
        await page.evaluate(value => {localStorage.setItem("trade-os-theme",value); document.documentElement.classList.toggle("dark",value === "dark");},theme);
        await page.setViewportSize({width:390,height:844});
        await page.reload();
        await browserExpect(page.getByRole("button",{name:"Download Windows companion preview",exact:true})).toBeEnabled();
        expect(await page.getByRole("button",{name:"Download Windows companion preview",exact:true}).evaluate(element => {
          const child=element.getBoundingClientRect(), parent=element.parentElement!.getBoundingClientRect();
          return child.right<=parent.right && child.left>=parent.left;
        })).toBe(true);
        expect(await page.locator('[data-slot="card-header"]').evaluate(header => {
          const bounds=header.parentElement!.getBoundingClientRect();
          return Array.from(header.querySelectorAll('[data-slot="badge"],[data-slot="card-description"]')).every(child => {
            const rectangle=child.getBoundingClientRect();return rectangle.right<=bounds.right && rectangle.left>=bounds.left;
          });
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await mkdir(".artifacts/integration-setup",{recursive:true});
        await page.screenshot({path:`.artifacts/integration-setup/companion-${theme}-mobile.png`,fullPage:true});
        expect(await page.locator('[data-slot="badge"]').evaluate(badge => badge.scrollHeight<=badge.clientHeight+1)).toBe(true);
      }
    } else {
      await browserExpect(page.getByText("No verified companion download is available", {exact:false})).toBeVisible();
      await browserExpect(page.getByRole("button", {name:"Download Windows companion preview",exact:true})).toHaveCount(0);
    }
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const response = await page.request.get(`${origin}/api/integrations/setup/${id}/configuration`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const config = await response.json();
    expect(config.resource).toBe(`${origin}/mcp`); expect(config.redirectUri).toBe("http://127.0.0.1:9882/callback");
    expect(Object.keys(config).sort()).toEqual(["allowLoopback", "clientId", "issuer", "profile", "redirectUri", "resource", "version"].sort());
    const anonymous = await fetch(`${origin}/api/integrations/setup/${id}/configuration`, { redirect: "manual" });
    expect(anonymous.status).not.toBe(200); await anonymous.body?.cancel();
  });
  it("prepares an account-bound MT5 bootstrap without inventing terminal or collector facts", async () => {
    await page.goto(`${origin}/settings/integrations/connect/mt5`);
    await page.getByLabel("Trade OS account", { exact: true }).selectOption(account);
    expect(await page.getByLabel("Trade OS account", { exact: true }).textContent()).toContain("Setup USD demo");
    await page.getByRole("button", { name: "Prepare connection setup", exact: true }).click();
    await page.getByRole("link", { name: "Continue saved setup →", exact: true }).click();
    await page.waitForURL(/\/settings\/integrations\/setup\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const response = await page.request.get(`${origin}/api/integrations/setup/${id}/configuration`);
    expect(response.status()).toBe(200);
    const bootstrap = await response.json();
    expect(bootstrap).toMatchObject({ format: "trade-os-setup", ownerId: owner, account: { id: account, name: "Setup USD demo", currencyPrecision: 2 } });
    expect(bootstrap).not.toHaveProperty("terminal"); expect(bootstrap).not.toHaveProperty("connectionId");
    expect((await db!.query("select count(*)::int as count from private.integration_grants where owner_id=$1", [owner])).rows[0].count).toBe(0);
  });
  it("shows database-disabled setup explicitly and preserves keyboard/mobile/theme behavior", async () => {
    await db!.query("update private.integration_setup_policies set enabled=false where purpose='MCP'");
    await page.goto(`${origin}/settings/integrations/connect/mcp`);
    await browserExpect(page.getByText("New setup is disabled by the database rollout policy.", { exact: false })).toBeVisible();
    await browserExpect(page.getByRole("button", { name: "Prepare connection setup", exact: true })).toBeDisabled();
    const saved = (await listSetupProfiles(client)).find(row => row.clientKind === "GEMINI_CLI")!;
    await page.goto(origin + "/settings/integrations/setup/" + saved.id);
    await browserExpect(page.getByRole("button", {name:"Download Windows companion preview",exact:true})).toHaveCount(0);
    await db!.query("update private.integration_setup_policies set enabled=true where purpose='MCP'");
    await mkdir(".artifacts/integration-setup", { recursive: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { localStorage.setItem("trade-os-theme", value); document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/settings/integrations/connect/mcp`);
      await browserExpect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*\bdark\b)/);
      await browserExpect(page.getByRole("button", { name: "Prepare connection setup", exact: true })).toBeEnabled();
      const selector = page.getByLabel("Integration client", { exact: true });
      await selector.focus(); await browserExpect(selector).toBeFocused();
      await selector.press("Home"); await browserExpect(selector).toHaveValue("CODEX");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `.artifacts/integration-setup/${theme}-mobile.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/settings/integrations`);
    await browserExpect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
    await browserExpect(page.locator("html")).toHaveClass(/dark/);
    await browserExpect(page.getByRole("button", { name: "Use light theme", exact: true })).toBeVisible();
    await page.screenshot({ path: ".artifacts/integration-setup/dark-desktop.png", fullPage: true });
    expect(browserErrors).toEqual([]);
  });
  it("reviews a fixture terminal in the browser and downloads only its approved paused mapping", async () => {
    // This seeded grant represents completed consent; it is NOT proof of a real
    // terminal or a new provider approval. No broker SDK/terminal is invoked.
    const profile = (await listSetupProfiles(client)).find(row => row.clientKind === "MT5_WINDOWS" && row.status === "READY")!;
    await db!.query("insert into private.integration_grants(owner_id,client_id,purpose,account_id,resource,authorization_id,status) values($1,$2,'MT5',$3,$4,$5,'ACTIVE')",
      [owner, profile.clientId, account, profile.resource, "pair-browser-" + randomUUID()]);
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(origin + "/settings/integrations/setup/" + profile.id);
    const proposal = {format: "trade-os-mt5-pairing", version: 1, profileId: profile.id, ownerId: owner, accountId: account,
      clientId: profile.clientId, observedAt: new Date().toISOString(), existingConnectionId: null, terminal: {
        executable: "D:\\DedicatedFixture\\terminal64.exe", dataPath: "D:\\DedicatedFixture\\data", portable: false, dedicatedApproved: true,
        identity: {server: "Fixture-Demo", login: "123456", terminalInstallationId: randomUUID(), currencyCode: "USD", currencyPrecision: 2, accountKind: "DEMO", positionMode: "HEDGING"},
      }};
    await page.getByLabel("Companion terminal review file").setInputFiles({name: "pairing-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(proposal))});
    await browserExpect(page.getByText("Fixture-Demo · 123456 · DEMO", {exact: true})).toBeVisible();
    await page.getByLabel("Mapping approval reason").fill("Review isolated demo terminal fixture");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", {name: "Approve terminal mapping", exact: true}).click();
    await browserExpect(page.getByText("Mapping approved at", {exact: false})).toBeVisible();
    const response = await page.request.get(origin + "/api/integrations/setup/" + profile.id + "/pairing");
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toMatchObject({version: 1, binding: {ownerId: owner, accountId: account}, terminal: proposal.terminal});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({path: ".artifacts/integration-setup/pairing-dark-mobile.png", fullPage: true});
    expect(browserErrors).toEqual([]);
  });
  it("returns bounded HTTP conflicts for stale activation and revocation without changing access", async () => {
    const profile = (await listSetupProfiles(client)).find(row => row.clientKind === "CODEX" && row.status === "READY")!;
    const grantId = randomUUID();
    await db!.query(`insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
      values($1,$2,$3,'MCP',$4,$5,'PENDING')`, [grantId, owner, profile.clientId, profile.resource, `setup-fixture-${randomUUID()}`]);
    const grant = (await db!.query("select authorization_id from private.integration_grants where id=$1", [grantId])).rows[0];
    const activation = await client.rpc("activate_integration_grant", { p_authorization_id: grant.authorization_id, p_expected_version: "99" });
    expect(activation.error?.code).toBe("PT409");
    const revocation = await client.rpc("revoke_integration_grant", { p_grant_id: grantId, p_expected_version: "99" });
    expect(revocation.error?.code).toBe("PT409");
    expect((await db!.query("select status,version::text,revoked_at from private.integration_grants where id=$1", [grantId])).rows[0])
      .toEqual({ status: "PENDING", version: "1", revoked_at: null });
    expect((await db!.query("select count(*)::int as count from private.integration_grant_events where grant_id=$1", [grantId])).rows[0].count).toBe(0);
  });
});

afterAll(async () => {
  let failed = false;
  await ui?.close(); vi.unstubAllEnvs();
  if (db && locked) {
    try {
      const ids = owner ? (await db.query("select c.id from auth.oauth_clients c join private.integration_setup_profiles p on c.client_name='Trade OS ' || p.client_kind || ' setup ' || p.id::text where p.owner_id=$1", [owner])).rows.map(row => row.id) : [];
      await db.query("begin");
      if (owner) {
        await db.query("set local session_replication_role=replica");
        await db.query("delete from private.mt5_setup_pairings where owner_id=$1", [owner]);
        await db.query("delete from private.integration_mutation_audits where owner_id=$1", [owner]);
        await db.query("delete from private.integration_operations where owner_id=$1", [owner]);
        await db.query("delete from private.mt5_connections where owner_id=$1", [owner]);
        await db.query("delete from private.integration_setup_events where actor_user_id=$1", [owner]);
        await db.query("delete from private.integration_setup_profiles where owner_id=$1", [owner]);
        await db.query("delete from private.integration_grant_events where actor_user_id=$1", [owner]);
        await db.query("delete from private.integration_grants where owner_id=$1", [owner]);
        await db.query("delete from public.trading_accounts where user_id=$1", [owner]);
      }
      if (changed) {
        for (const purpose of ["MT5", "MCP"]) {
          const policy = previousPolicies.find(row => row.purpose === purpose);
          if (policy) await db.query("update private.integration_setup_policies set enabled=$2 where purpose=$1", [purpose, policy.enabled]);
          else await db.query("delete from private.integration_setup_policies where purpose=$1", [purpose]);
          const resource = previousResources.find(row => row.purpose === purpose);
          if (resource) await db.query("update private.integration_resources set resource=$2,enabled=$3 where purpose=$1", [purpose, resource.resource, resource.enabled]);
          else await db.query("delete from private.integration_resources where purpose=$1", [purpose]);
        }
      }
      if (pairingSchemaCreated) {
        if ((await db.query("select count(*)::int as count from private.mt5_setup_pairings")).rows[0].count) throw Error("Another owner's pairing must be preserved");
        await db.query("drop function public.approve_mt5_setup_pairing(jsonb),public.get_mt5_setup_pairing(uuid,text); drop function private.approve_mt5_setup_pairing(jsonb),private.get_mt5_setup_pairing(uuid,text); drop function private.mt5_pairing_view(private.mt5_setup_pairings),private.mt5_pairing_path_valid(text); drop table private.mt5_setup_pairings;");
      }
      if (schemaCreated) {
        if ((await db.query("select count(*)::int as count from private.integration_setup_profiles")).rows[0].count) throw Error("Another owner's setup must be preserved");
        await db.query(`drop trigger integration_setup_grant_binding on private.integration_grants;
          drop function private.enforce_setup_grant_binding();
          drop function public.reserve_integration_setup(uuid,text,uuid,text),public.reconcile_integration_setup(uuid,text),public.list_integration_setups();
          drop function private.reserve_integration_setup(uuid,text,uuid,text),private.reconcile_integration_setup(uuid,text),private.list_integration_setups();
          drop function private.integration_setup_view(private.integration_setup_profiles);
          drop table private.integration_setup_events,private.integration_setup_profiles,private.integration_setup_policies;`);
        for (const definition of previousRpcDefinitions) await db.query(definition);
      }
      await db.query("commit");
      for (const id of ids) { if ((await admin!.auth.admin.oauth.deleteClient(id)).error) failed = true; }
      if (owner && (await admin!.auth.admin.deleteUser(owner)).error) failed = true;
    } catch { failed = true; await db.query("rollback").catch(() => {}); }
    finally {
      if (diagnosticHintsChanged) {
        try { localDiagnosticHints("restore"); }
        catch { failed = true; }
      }
      await db.query("select pg_advisory_unlock(670051234)").catch(() => { failed = true; });
    }
  }
  await db?.end();
  if (failed) throw Error("Disposable setup fixture cleanup or restoration failed; details suppressed");
}, 120000);
