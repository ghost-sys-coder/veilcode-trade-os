# MCP: actual Codex client checkpoint

Recorded 2026-10-12 (Africa/Kampala). This is partial acceptance of checklist
item 5, not full MCP completion or authorization to enable production MCP.

## Hosted consent and boundaries

The user approved "Trade OS MCP staging - Codex stdio" through the corrected
normal browser flow. The callback receiver exited successfully and verified a
signed resource-bound token and live remote tools before saving Windows-protected
credentials. Public client ID: `93aa702b-b214-464b-9b82-7eac91949078`; exact
loopback callback: `http://127.0.0.1:9878/callback`.

Staging resource: `https://mcp-preview.veilcode.studio/mcp`. Production MCP remains
disabled; staging MT5 remains disabled. Hosted readback confirmed one ACTIVE MCP
grant, one unexpired matching provider session created after the grant, the exact
staging resource and unchanged MT5 grant fingerprint. No accounts, trades,
terminal settings, collector state or existing client configuration were changed.

Current hosted source is `09e4005`; immutable deployment identifiers and hosted
boundary checks are in [the corrected release receipt](MCP_CONSENT_RELEASE_VERIFICATION.md).

## Actual native client evidence

Client: Codex CLI **0.147.0**, invoked through its installed Node launcher at
`C:/nvm4w/nodejs/node_modules/@openai/codex/bin/codex.js`. The installed VS Code
extension separately reports **0.162.0-alpha.17.2**; it is not counted as tested.
The 0.147.0 binary generated its own protocol schema for method verification.

The bounded native harness used `app-server --stdio`, `initialize`, and
`config/read` before any MCP startup. Whole-table CLI overrides merge with the
user configuration in the unrestricted environment: existing server names were
explicitly disabled for this invocation, then effective configuration was checked
again. It contained exactly one enabled MCP server, `tradeos_staging`. Configuration
files were never written, provider keys were never loaded into the harness, and
no other MCP server was started. Analytics/apps/plugins were disabled for the
test invocation. The model endpoint was pointed at an unused loopback port as a
defensive barrier; no `turn/start`, inference prompt or model call was made.

| Actual native check | Evidence |
| --- | --- |
| `mcpServerStatus/list`, full inventory, standalone process | Exactly 84 tools, eight resources, no next cursor; server `trade-os-stdio` v1.0.0 |
| Ephemeral read-only thread, no model turn | Staging MCP startup reached READY |
| `mcpServer/tool/call`: `tradeos_capabilities` | Structured catalog contains 84 tools/eight resources |
| `mcpServer/tool/call`: `tradeos_accounts_list`, limit 1 | Owner-scoped application response, not just public discovery |
| `mcpServer/resource/read` | `domain`, `money`, `workflows`, `catalog`: four exact-URI JSON resources |
| Protocol stdout | Zero non-JSON protocol lines |

The local stdio server reports native `authStatus=unsupported` because its OAuth
is handled by the authenticated adapter, not Codex's native remote OAuth helper.
This is not anonymous access: the adapter verified the signed token and every
remote request went through the live grant boundary.

Commands recorded: `node .artifacts/mcp-clients/codex-native-check.mjs --discover`
and the same harness with `--read`, run sequentially. Private responses stayed in
memory; sanitized receipts are ignored under `.artifacts/mcp-clients/`.
The initial harness attempts are not passes: a sandboxed run could not use the
protected profile, a whole-table-only override failed effective isolation and
aborted before startup, and inventory calls during thread startup competed for
one profile. Standalone inventory and thread-scoped reads were subsequently
verified in separate processes; process inspection found no retained test adapter.
The native read process emitted non-protocol stderr including an OS-error category;
its requested tool/resource reads and READY startup passed. This does not claim a
warning-free entire Codex session.

## Renewal: failed closed, hosted retest required

`node .artifacts/mcp-clients/verify-codex-renewal.mjs` invoked the documented
adapter `refresh` command. It exited 1 with `REFRESH_UNCERTAIN`. A subsequent
`--status` probe confirmed LOGIN_REQUIRED. No refresh replay or new consent
window was attempted after the user went to sleep.

Read-only, bounded hosted Auth-log aggregation showed one `/oauth/token` refresh
request completed HTTP 200 and the private access-token hook reported success.
The existing session/grant remained valid and MT5 unchanged. The previous adapter
discarded the underlying local validation/storage failure stage, so those logs
alone do **not** establish the exact failing local step.

Code inspection nevertheless found a concrete compatibility defect: initial
exchange and refresh used the same schema requiring a replacement refresh token.
[Supabase's refresh-response contract](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows#refresh-response)
allows a successful refresh response to omit that replacement. The adapter now
retains the previous validated refresh token **only** after a successful response
omits it and the new access token passes the existing signature, issuer,
resource, expiry and client checks. An explicitly null/empty/malformed token is
rejected. Initial exchange still requires a refresh token. The durable pre-clear,
no-replay handling, private storage and live grant checks are unchanged.

Allowlisted diagnostics distinguish PRE_CLEAR, PROVIDER_REQUEST, TOKEN_RESPONSE,
TOKEN_VERIFICATION and CREDENTIAL_SAVE without outputting tokens, payloads or raw
errors. Ten new unit cases cover omission, malformed replacements, initial
exchange, wrong client, failed verification/save and safe diagnostics. This
compatibility fix is **not yet proven to resolve the hosted refresh failure**.
The cleared local profile must be restored by normal fresh browser consent, then
renewal and another native read must pass. Do not revoke/remap MT5 or recover
secrets from provider tables/backups to bypass login.

## Verification and remaining work

- Full unit suite: `node node_modules/vitest/vitest.mjs run --maxWorkers=1`:
  **1065 tests / 62 files PASS**.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- Full lint: `node node_modules/eslint/bin/eslint.js`: PASS.
- Production build: `node node_modules/next/dist/bin/next build`: PASS,
  Next.js 16.3.8; public calculator remains statically generated.
- Changed-adapter regression:
  `node --experimental-strip-types scripts/test-mcp-integration.mts --stdio-only`:
  **10 checks PASS**, real disposable provider/browser/DPAPI/legacy and modern
  stdio subprocesses (Chrome 154.0.8037.99, SDK 2.3.1). Its first attempt found
  no test server on port 3100 and failed before discovery; it is not a pass.
  The existing isolated local server was then started and the complete focused
  gate passed. Its local fixtures were cleaned; no hosted fallback was used.
- Previous correction gate: five real-provider, 65 browser/provider, 72 full
  SDK/HTTP/stdio checks and 27 database suites passed. No SQL/schema changed in
  this increment; those older results are not newly rerun claims.
- `git diff --check`: PASS. Exact current code is committed/pushed on the MCP
  feature branch only; production activation and master consolidation are separate.

Remaining: fresh Codex login/hosted renewal, bounded actual-client write/retry/
concurrency and revocation/reconnect; separate consent and acceptance for Claude
Code, Gemini CLI, ChatGPT Desktop/remote and Claude remote; final hosted matrix
and explicitly authorized production enablement. Other-client version/help checks
and SDK fixture tests do not substitute for actual-client passes. No paid/model
API usage or broker execution was introduced.
