import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";
import { integrationSigningKeys, verifyIntegrationToken } from "../services/integrations/verify-token.ts";
import type { IntegrationDatabase } from "../types/integration-database.ts";

// Real provider flow, local Docker only. No .env, paid API, model or hosted writes.
let stage = "local discovery";
let fixtureUser: string | undefined;
let fixtureClient: string | undefined;
let previousResource: { purpose: string; resource: string; enabled: boolean } | undefined;
let database: pg.Client | undefined;
let admin: ReturnType<typeof createClient> | undefined;
let checks = 0;
let browserUi: Browser | undefined;
let page: Page | undefined;
const withBrowser = process.argv.includes("--browser");
const uiOrigin = "http://127.0.0.1:3100";
const artifactDirectory = fileURLToPath(new URL("../.artifacts/integration-tests/", import.meta.url));
const pythonSpool = fileURLToPath(new URL(`../.artifacts/integration-tests/python-${randomUUID()}.sqlite3`, import.meta.url));
let pageErrors = 0;
function passed(message: string) { checks++; console.log(`PASS ${checks}: ${message}`); }
try {
  const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
  })) as Record<string, string>;
  const connection = databaseTestConnection(status.DB_URL);
  const api = new URL(status.API_URL);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(api.hostname));
  const resource = "http://127.0.0.1:3100/api/integrations/v1";
  const issuer = `${api.origin}/auth/v1`;
  const callback = "http://127.0.0.1:9876/callback";
  const anonKey = status.ANON_KEY;
  assert(anonKey && status.SERVICE_ROLE_KEY);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  admin = createClient(api.origin, status.SERVICE_ROLE_KEY, options);
  const browser = createClient<IntegrationDatabase>(api.origin, anonKey, options);
  database = new pg.Client(connection);
  database.on("error", () => { console.error("Local OAuth database connection interrupted."); process.exitCode = 1; });
  await database.connect();
  await database.query("select pg_advisory_lock(670051234)");
  previousResource = (await database.query("select * from private.integration_resources where purpose='MT5'")).rows[0];
  await database.query("insert into private.integration_resources(purpose,resource,enabled) values('MT5',$1,true) on conflict(purpose) do update set resource=excluded.resource,enabled=true", [resource]);
  stage = "fixture identity";
  const password = randomBytes(32).toString("base64url");
  const email = `integration-${randomUUID()}@example.test`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert(!user.error && user.data.user); fixtureUser = user.data.user.id;
  const signIn = await browser.auth.signInWithPassword({ email, password });
  assert(!signIn.error && signIn.data.session);
  const accountResult = await browser.from("trading_accounts").select("id").limit(1).single();
  assert(!accountResult.error && accountResult.data);
  passed("direct browser login and seeded account reads remain compatible");
  stage = "client registration";
  const clientResponse = await fetch(`${issuer}/admin/oauth/clients`, {
    method: "POST", headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Trade OS local gate fixture", redirect_uris: [callback], client_type: "public",
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    signal: AbortSignal.timeout(10_000),
  });
  assert(clientResponse.ok);
  const registered = await clientResponse.json() as { client_id: string };
  fixtureClient = registered.client_id; assert(fixtureClient);
  if (withBrowser) {
    stage = "isolated browser startup";
    // Fresh headless profile; never attach to the user's browser or save cookies.
    browserUi = await chromium.launch({ channel: "chrome", headless: true });
    page = await browserUi.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30_000);
    page.on("pageerror", () => { pageErrors++; });
    await page.route(`${callback}**`, route => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Local callback fixture</h1>" }));
    await mkdir(artifactDirectory, { recursive: true });
    stage = "public browser calculator";
    const publicResponse = await page.goto(`${uiOrigin}/tools/position-size-calculator`);
    assert.equal(publicResponse?.status(),200);
    assert.equal(new URL(page.url()).pathname,"/tools/position-size-calculator");
    assert.equal(await page.getByRole("button",{ name: "Sign in", exact: true }).count(),1);
    passed("anonymous browser calculator is public without an authentication redirect");
    const metadata = await fetch(`${uiOrigin}/.well-known/oauth-protected-resource/api/integrations/v1`);
    assert.equal(metadata.status,200);
    assert.equal((await metadata.json() as { resource: string }).resource,resource);
    const unauthenticated = await fetch(`${uiOrigin}/api/integrations/v1/session`);
    assert.equal(unauthenticated.status,401);
    assert(unauthenticated.headers.get("www-authenticate")?.includes("resource_metadata="));
    passed("public resource discovery and unauthenticated API challenge are correct");
    stage = "actual browser login";
    await page.goto(`${uiOrigin}/login?next=${encodeURIComponent("/settings/integrations")}`);
    await page.getByLabel("Email address",{ exact: true }).fill(email);
    await page.getByLabel("Password",{ exact: true }).fill(password);
    await page.getByRole("button",{ name: "Sign in", exact: true }).click();
    await page.waitForURL(`${uiOrigin}/settings/integrations`);
    await page.getByRole("heading",{ name: "Integrations & connected clients", exact: true }).waitFor();
    await page.goto(`${uiOrigin}/login?next=${encodeURIComponent("/settings/integrations")}`);
    await page.waitForURL(`${uiOrigin}/settings/integrations`);
    passed("browser login works and logged-in users cannot return to the login page");
    stage = "authenticated public calculator";
    await page.goto(`${uiOrigin}/tools/position-size-calculator`);
    await page.getByRole("button",{ name: "Open dashboard", exact: true }).waitFor();
    assert.equal(await page.getByRole("button",{ name: "Sign in", exact: true }).count(),0);
    passed("logged-in public calculator does not show a sign-in button");
  }

  async function requestAuthorization(targetResource: string) {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(`${issuer}/oauth/authorize`);
    url.search = new URLSearchParams({ client_id: fixtureClient!, redirect_uri: callback, response_type: "code", scope: "email",
      state: randomUUID(), resource: targetResource, code_challenge_method: "S256", code_challenge: challenge }).toString();
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    assert([302,303,307].includes(response.status));
    const authorizationId = new URL(response.headers.get("location")!).searchParams.get("authorization_id");
    assert(authorizationId);
    const details = await browser.auth.oauth.getAuthorizationDetails(authorizationId);
    assert(!details.error && details.data && "authorization_id" in details.data);
    return { authorizationId, verifier, state: url.searchParams.get("state")! };
  }
  async function exchange(code: string, verifier: string) {
    return fetch(`${issuer}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: fixtureClient!, redirect_uri: callback, code, code_verifier: verifier, resource }),
      signal: AbortSignal.timeout(10_000) });
  }
  stage = "wrong resource consent";
  const wrong = await requestAuthorization("https://wrong.example/resource");
  const denied = await browser.rpc("approve_integration_grant", { p_authorization_id: wrong.authorizationId, p_purpose: "MT5", p_account_id: accountResult.data.id });
  assert(denied.error?.code === "42501");
  passed("real authorization with a wrong resource cannot obtain an application grant");
  await browser.auth.oauth.denyAuthorization(wrong.authorizationId, { skipBrowserRedirect: true });
  stage = "grant approval";
  const request = await requestAuthorization(resource);
  let approvedGrant: { id: string; version: string };
  let redirect: URL;
  if (page) {
    stage = "actual browser consent";
    await page.goto(`${uiOrigin}/oauth/consent?authorization_id=${encodeURIComponent(request.authorizationId)}`);
    const selector = page.getByLabel("Authorized trading account",{ exact: true });
    await selector.waitFor();
    assert.equal(await selector.inputValue(),"");
    const optionText = await selector.locator(`option[value="${accountResult.data.id}"]`).innerText();
    assert(optionText.length > 0 && !optionText.includes(accountResult.data.id));
    await selector.selectOption(accountResult.data.id);
    if (await page.getByRole("button",{ name: "Use light theme", exact: true }).count()) await page.getByRole("button",{ name: "Use light theme", exact: true }).click();
    await page.screenshot({ path: `${artifactDirectory}/consent-approved-light.png` });
    await page.getByRole("button",{ name: "Use dark theme", exact: true }).click();
    await page.screenshot({ path: `${artifactDirectory}/consent-approved-dark.png` });
    await page.getByRole("button",{ name: "Approve access", exact: true }).click();
    await page.waitForURL(url => url.origin + url.pathname === callback && url.searchParams.has("code"));
    redirect = new URL(page.url());
    const listed = await browser.rpc("list_integration_grants");
    assert(!listed.error && Array.isArray(listed.data));
    const activeGrant = listed.data.find(item => typeof item === "object" && item !== null && "client_id" in item && item.client_id === fixtureClient);
    assert(activeGrant && typeof activeGrant === "object" && "status" in activeGrant && activeGrant.status === "ACTIVE");
    approvedGrant = activeGrant as { id: string; version: string };
    passed("real browser consent displays account names and atomically activates the selected grant");
  } else {
    const grant = await browser.rpc("approve_integration_grant", { p_authorization_id: request.authorizationId, p_purpose: "MT5", p_account_id: accountResult.data.id });
    assert(!grant.error && grant.data);
    approvedGrant = grant.data as { id: string; version: string };
    const approval = await browser.auth.oauth.approveAuthorization(request.authorizationId, { skipBrowserRedirect: true });
    assert(!approval.error && approval.data);
    const activated = await browser.rpc("activate_integration_grant", { p_authorization_id: request.authorizationId, p_expected_version: approvedGrant.version });
    assert(!activated.error);
    redirect = new URL(approval.data.redirect_url);
  }
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get("state"),request.state);
  const code = redirect.searchParams.get("code"); assert(code);
  stage = "PKCE rejection";
  const invalid = await exchange(code, randomBytes(48).toString("base64url"));
  assert(!invalid.ok);
  passed("wrong PKCE verifier is rejected by the provider");
  stage = "PKCE exchange";
  const response = await exchange(code, request.verifier); assert(response.ok);
  const tokens = await response.json() as { access_token: string; refresh_token: string };
  assert(tokens.access_token && tokens.refresh_token);
  stage = "signed resource claims";
  const signingKey = integrationSigningKeys(issuer);
  const verified = await verifyIntegrationToken(tokens.access_token, { issuer, resource, key: signingKey });
  assert.equal(verified.trade_os_grant_id, approvedGrant.id);
  passed("real S256 exchange issues a signature-verified, intended-resource token");
  await assert.rejects(verifyIntegrationToken(tokens.access_token, { issuer, resource: "https://wrong.example", key: signingKey }));
  passed("real token is rejected for another resource");
  const integration = createClient<IntegrationDatabase>(api.origin, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${tokens.access_token}` } } });
  const actor = await integration.rpc("authorize_integration", { p_resource: resource, p_purpose: "MT5" });
  assert(!actor.error && actor.data);
  assert.equal((actor.data as { account_id: string }).account_id, accountResult.data.id);
  passed("live database authorization binds the correct owner, client and account");
  if (page) {
    const endpoint = await fetch(`${uiOrigin}/api/integrations/v1/session`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(endpoint.status,200);
    assert.equal((await endpoint.json() as { actor: { account_id: string } }).actor.account_id,accountResult.data.id);
    passed("the actual HTTP API verifies signed bearer tokens and live account grants");
    stage = "real authenticated MT5 capture API";
    const identity = { server: "Broker-Demo",login: "12345",terminalInstallationId: randomUUID(),
      currencyCode: "USD",currencyPrecision: 2,accountKind: "DEMO",positionMode: "NETTING" };
    const mapping = await browser.rpc("mt5_register_connection", { p_grant_id: approvedGrant.id,p_operation_id: randomUUID(),p_identity: identity });
    assert(!mapping.error && mapping.data && typeof mapping.data === "object" && "connectionId" in mapping.data);
    const connectionId = mapping.data.connectionId as string;
    const workerId = randomUUID();
    const headers = { Authorization: `Bearer ${tokens.access_token}`,"Content-Type": "application/json" };
    const leaseResponse = await fetch(`${uiOrigin}/api/integrations/v1/mt5/lease`,{ method: "POST",headers,
      body: JSON.stringify({ connectionId,workerId,operationId: randomUUID() }),signal: AbortSignal.timeout(10_000) });
    assert.equal(leaseResponse.status,200);
    const lease = await leaseResponse.json() as { fencingToken: string };
    assert.equal(lease.fencingToken,"1");
    passed("the signed MT5 client obtains only its explicitly mapped connection lease");
    const observedAt = new Date().toISOString();
    const batch = { connectionId,workerId,operationId: randomUUID(),fencingToken: lease.fencingToken,identity,checkpoint: observedAt,
      collection: { id: randomUUID(),index: 2,count: 3 },
      events: [{ kind: "DEAL",sourceId: "10",observedAt,payload: { ticket: "10",orderId: "10",positionId: "100",symbol: "EURUSD",type: "BUY",entry: "IN",
        occurredAt: "2026-01-01T00:00:00.000Z",volume: "1",price: "1.1",profit: "0",commission: "-2",swap: "0",fee: "0" } }] };
    async function capture(payload: unknown) {
      const response = await fetch(`${uiOrigin}/api/integrations/v1/mt5/capture`,{ method: "POST",headers,body: JSON.stringify(payload),signal: AbortSignal.timeout(10_000) });
      return { status: response.status,data: await response.json() as Record<string,unknown> };
    }
    const [first,concurrent] = await Promise.all([capture(batch),capture(batch)]);
    assert.equal(first.status,200); assert.deepEqual(concurrent,first);
    assert.equal(first.data.status,"STAGED"); assert.equal(first.data.revisionCount,1);
    assert.equal(first.data.collectionComplete,false); assert.equal(first.data.checkpoint,null);
    const acknowledgementReplay = await capture(batch); assert.deepEqual(acknowledgementReplay,first);
    const durable = await database.query("select (select count(*)::integer from private.mt5_source_revisions where connection_id=$1) as revisions,(select count(*)::integer from private.integration_operations where owner_id=$2 and operation_kind='MT5_CAPTURE') as operations",[connectionId,fixtureUser]);
    assert.deepEqual(durable.rows[0],{ revisions: 1,operations: 1 });
    passed("concurrent HTTP uploads and lost acknowledgements have exactly one durable effect");
    const newerCheckpoint = new Date(Date.parse(observedAt)+1).toISOString();
    const newer = await capture({ ...batch,operationId: randomUUID(),checkpoint: newerCheckpoint,
      collection: { id: randomUUID(),index: 0,count: 1 },events: [] });
    assert.equal(newer.status,200); assert.equal(newer.data.collectionComplete,true); assert.equal(newer.data.checkpoint,null);
    passed("a complete newer HTTP collection cannot advance across older missing batches");
    const remaining = await Promise.all([0,1].map(index => capture({ ...batch,operationId: randomUUID(),collection: { ...batch.collection,index },events: [] })));
    assert(remaining.every(response => response.status === 200));
    assert.equal(remaining.filter(response => response.data.collectionComplete === true).length,1);
    const checkpoint = await database.query("select capture_checkpoint,(select count(*)::integer from private.mt5_capture_batches where connection_id=$1) as batches from private.mt5_connections where id=$1",[connectionId]);
    assert.equal(checkpoint.rows[0].capture_checkpoint.toISOString(),newerCheckpoint); assert.equal(checkpoint.rows[0].batches,4);
    assert.deepEqual(await capture(batch),first);
    passed("out-of-order concurrent collection uploads advance checkpoints only after every slot commits");
    const operation = await fetch(`${uiOrigin}/api/integrations/v1/operations/${batch.operationId}`,{ headers,signal: AbortSignal.timeout(10_000) });
    assert.equal(operation.status,200);
    const receipt = await operation.json() as { status: string; result: unknown };
    assert.equal(receipt.status,"COMMITTED"); assert.deepEqual(receipt.result,first.data);
    assert.equal(operation.headers.get("Cache-Control"),"no-store");
    const unknownOperation = await fetch(`${uiOrigin}/api/integrations/v1/operations/${randomUUID()}`,{ headers,signal: AbortSignal.timeout(10_000) });
    assert.equal(unknownOperation.status,200); assert.equal((await unknownOperation.json() as { status: string }).status,"UNKNOWN");
    passed("authenticated operation lookup distinguishes durable original receipts from unknown operations");
    const changed = await capture({ ...batch,checkpoint: "2026-01-01T00:00:00.000Z" });
    assert.equal(changed.status,409); assert.equal(changed.data.error,"OPERATION_CONFLICT");
    passed("changed HTTP payloads using an existing operation ID are rejected");
    const stale = await capture({ ...batch,operationId: randomUUID(),fencingToken: "2" });
    assert.equal(stale.status,409); assert.equal(stale.data.error,"COLLECTOR_REQUIRES_ATTENTION");
    passed("stale HTTP fencing tokens cannot produce writes");
    stage = "real Python fenced upload recovery";
    async function expireFixtureLease() {
      const expired = await database!.query("update private.mt5_connections set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1 and owner_id=$2",[connectionId,fixtureUser]);
      assert.equal(expired.rowCount,1);
    }
    function pythonFixture(action: string, pythonWorker: string, ticket?: string) {
      const input = { origin: uiOrigin,ownerId: fixtureUser,accountId: accountResult.data!.id,connectionId,identity,
        spoolPath: pythonSpool,workerId: pythonWorker,accessToken: tokens.access_token,action,
        checkpoint: new Date().toISOString(),event: ticket ? { ...batch.events[0],sourceId: ticket,
          payload: { ...batch.events[0].payload,ticket,orderId: ticket,positionId: ticket+"0" } } : undefined };
      const output = execFileSync("python",["-m","trade_os_mt5.verify_local_api"],{
        cwd: fileURLToPath(new URL("..",import.meta.url)),
        env: { ...process.env,PYTHONPATH: fileURLToPath(new URL("../integrations/mt5",import.meta.url)) },
        input: JSON.stringify(input),encoding: "utf8",stdio: ["pipe","pipe","pipe"],timeout: 60_000,
      });
      return JSON.parse(output) as { pending: number; operationId: string; serverCheckpoint: string | null };
    }
    async function captureOperationCount(operationId: string) {
      return (await database!.query("select count(*)::integer as count from private.integration_operations where owner_id=$1 and operation_id=$2 and operation_kind='MT5_CAPTURE'",[fixtureUser,operationId])).rows[0].count as number;
    }
    await expireFixtureLease();
    const lostAck = pythonFixture("capture_lost_ack",randomUUID(),"20");
    assert.equal(lostAck.pending,1); assert.equal(await captureOperationCount(lostAck.operationId),1);
    await expireFixtureLease();
    const replacementWorker = randomUUID();
    const committedRecovery = pythonFixture("recover",replacementWorker);
    assert.equal(committedRecovery.pending,0); assert.equal(await captureOperationCount(lostAck.operationId),1);
    assert(committedRecovery.serverCheckpoint);
    passed("real Python restart recovers a committed lost acknowledgement under a newer lease without another capture");
    const uncommitted = pythonFixture("prepare_uncommitted",replacementWorker,"30");
    assert.equal(uncommitted.pending,1); assert.equal(await captureOperationCount(uncommitted.operationId),0);
    await expireFixtureLease();
    const unknownRecovery = pythonFixture("recover",randomUUID());
    assert.equal(unknownRecovery.pending,0); assert.equal(await captureOperationCount(uncommitted.operationId),0);
    const pythonEffects = await database.query("select source_id,count(*)::integer as revisions from private.mt5_source_revisions where connection_id=$1 and source_id in ('20','30') group by source_id order by source_id",[connectionId]);
    assert.deepEqual(pythonEffects.rows,[{ source_id: "20",revisions: 1 },{ source_id: "30",revisions: 1 }]);
    passed("real Python recovery replaces an uncommitted request only after fenced UNKNOWN lookup and stages its source exactly once");
    await expireFixtureLease();
    const resumedLeaseResponse = await fetch(`${uiOrigin}/api/integrations/v1/mt5/lease`,{ method: "POST",headers,
      body: JSON.stringify({ connectionId,workerId,operationId: randomUUID() }),signal: AbortSignal.timeout(10_000) });
    assert.equal(resumedLeaseResponse.status,200);
    const resumedLease = await resumedLeaseResponse.json() as { fencingToken: string };
    const switched = await capture({ ...batch,operationId: randomUUID(),fencingToken: resumedLease.fencingToken,identity: { ...identity,login: "98765" } });
    assert.equal(switched.status,409); assert.equal(switched.data.status,"ATTENTION");
    const paused = await database.query("select status,(select count(*)::integer from private.mt5_source_revisions where connection_id=$1) as revisions from private.mt5_connections where id=$1",[connectionId]);
    assert.deepEqual(paused.rows[0],{ status: "ATTENTION",revisions: 3 });
    passed("an unexpected account switch pauses the HTTP connection without importing wrong-account facts");
  }
  const forbidden = await integration.from("trading_accounts").select("id");
  assert(!forbidden.error && forbidden.data?.length === 0);
  passed("a real authorized OAuth token cannot directly read workspace tables");
  stage = "refresh";
  const refresh = await fetch(`${issuer}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: fixtureClient!, refresh_token: tokens.refresh_token, resource }), signal: AbortSignal.timeout(10_000) });
  assert(refresh.ok);
  const renewed = await refresh.json() as { access_token: string; refresh_token: string };
  assert(renewed.access_token && renewed.refresh_token);
  assert.notEqual(renewed.refresh_token, tokens.refresh_token);
  await verifyIntegrationToken(renewed.access_token, { issuer, resource, key: signingKey });
  passed("renewable credentials preserve signed resource/grant binding");
  stage = "revocation";
  if (page) {
    stage = "actual browser revocation";
    await page.goto(`${uiOrigin}/settings/integrations`);
    await page.getByRole("button",{ name: "Revoke access", exact: true }).click();
    await page.waitForURL(`${uiOrigin}/settings/integrations?status=revoked`);
    await page.getByText("Application access and provider consent revoked.",{ exact: true }).waitFor();
    await page.getByRole("button",{ name: "Retry provider revocation", exact: true }).waitFor();
    await page.screenshot({ path: `${artifactDirectory}/connected-client-revoked-dark.png` });
    passed("browser connected-client management revokes both application and provider access");
  } else {
    const revoked = await browser.rpc("revoke_integration_grant", { p_grant_id: approvedGrant.id, p_expected_version: approvedGrant.version });
    assert(!revoked.error);
  }
  const revokedActor = await integration.rpc("authorize_integration", { p_resource: resource, p_purpose: "MT5" });
  assert(revokedActor.error?.code === "42501");
  passed("application revocation rejects an existing unexpired token immediately");
  const refreshAfterRevocation = await fetch(`${issuer}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: fixtureClient!, refresh_token: renewed.refresh_token, resource }), signal: AbortSignal.timeout(10_000) });
  assert(!refreshAfterRevocation.ok);
  passed("the signing hook refuses refresh after application revocation");
  if (!page) {
    const providerRevocation = await browser.auth.oauth.revokeGrant({ clientId: fixtureClient! }); assert(!providerRevocation.error);
    passed("provider consent/session revocation succeeds");
  }
  const browserAfter = await browser.auth.getUser(); assert(!browserAfter.error && browserAfter.data.user?.id === fixtureUser);
  passed("integration revocation leaves direct browser login intact");
  if (page) {
    await page.getByRole("button",{ name: "Sign out", exact: true }).first().click();
    await page.waitForURL(`${uiOrigin}/login`);
    await page.goto(`${uiOrigin}/settings/integrations`);
    await page.waitForURL(url => url.pathname === "/login");
    assert.equal(pageErrors,0);
    passed("browser logout protects the workspace and no uncaught client runtime errors occurred");
  }
  console.log(`Local OAuth gate: ${checks} checks passed. ${withBrowser ? "Local browser consent/regression verified;" : "Browser coverage pending;"} actual MT5 terminal and MCP clients pending separate verification.`);
} catch {
  console.error(`FAIL: local OAuth gate at ${stage}. Provider responses and credentials suppressed.`);
  process.exitCode = 1;
} finally {
  await browserUi?.close();
  // Only this runner's explicit UUID-named disposable spool, never a directory.
  assert(pythonSpool.startsWith(artifactDirectory) && /^python-[0-9a-f-]+\.sqlite3$/.test(pythonSpool.slice(artifactDirectory.length)));
  for (const suffix of ["","-wal","-shm"]) await rm(pythonSpool+suffix,{ force: true });
  try {
    if (database && fixtureUser) {
      // Disposable fixture cleanup is session-local and exact-owner scoped.
      // This is never a normal application/audit deletion workflow.
      await database.query("begin");
      await database.query("set local session_replication_role = replica");
      await database.query("delete from private.mt5_capture_progress where connection_id in (select id from private.mt5_connections where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.mt5_capture_batches where connection_id in (select id from private.mt5_connections where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.mt5_capture_collections where connection_id in (select id from private.mt5_connections where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.mt5_source_facts where connection_id in (select id from private.mt5_connections where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.mt5_source_revisions where connection_id in (select id from private.mt5_connections where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.mt5_connections where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_mutation_audits where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_operations where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_grant_events where actor_user_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_grants where owner_id=$1",[fixtureUser]);
      await database.query("commit");
      const removed = await admin!.auth.admin.deleteUser(fixtureUser);
      assert(!removed.error);
    }
    if (fixtureClient) { const removed = await admin!.auth.admin.oauth.deleteClient(fixtureClient); assert(!removed.error); }
    if (database) {
      if (previousResource) await database.query("update private.integration_resources set resource=$1,enabled=$2 where purpose='MT5'",[previousResource.resource,previousResource.enabled]);
      else await database.query("delete from private.integration_resources where purpose='MT5'");
      await database.query("select pg_advisory_unlock(670051234)");
    }
  } catch { console.error("Local OAuth fixture cleanup requires attention; details suppressed."); process.exitCode = 1; }
  finally { try { await database?.end(); } catch { process.exitCode = 1; } }
}
