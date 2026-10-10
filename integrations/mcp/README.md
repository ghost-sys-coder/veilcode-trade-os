# Trade OS local MCP adapter

Windows stdio transport for the existing authenticated `/mcp` application.
The official SDK forwards the same 84 tools/eight resources: no duplicated
domain logic, local database access, broker execution or model API calls.
MT5 need not be installed/running for ordinary application access. Python is
used only for the existing Windows DPAPI/ACL/OS-lock utility.

## Release boundary

This increment is locally verified. Hosted MCP remains disabled until the
separate real-client and final acceptance gates pass. A passing local SDK
fixture is not evidence that Codex, Claude, ChatGPT or Gemini has connected.
See [verification](../../docs/MCP_STDIO_VERIFICATION.md) and
[completion checklist](../../docs/MCP_COMPLETION_CHECKLIST.md).

## Requirements and public configuration

- Windows under the same user that completes browser consent.
- Node 22.18+ with type stripping (verified with Node 25.1.0), Python 3.13+
  on PATH and the checkout's installed `npm ci` dependencies.
- An enabled HTTPS Trade OS MCP resource with public discovery.
- A **separate pre-registered public OAuth client** for each AI client, with
  authentication method `none`, authorization-code/refresh grants and the exact
  callback `http://127.0.0.1:9878/callback` (or another configured explicit port).
  Do not reuse an MT5 client or pass a secret/service-role key to this adapter.

Copy `config.example.json` to a local, public JSON configuration. Replace its
placeholder `clientId` with the registered **public** client ID. Use a distinct
profile label/client ID for each client. For Preview, set `resource` to that
deployment's **configured canonical** `/mcp` URL, not an arbitrary immutable
Preview hostname. Issuer/resource/callback must match provider registration.
No passwords, access/refresh tokens, database credentials or provider API keys
belong in this JSON file. The adapter deliberately never loads `.env`.

`allowLoopback: true` is only for explicit disposable local verification;
non-loopback HTTP, embedded credentials, queries and fragments are rejected.
Discovery pins issuer/resource and endpoints; it never follows redirects to
another token destination. Public OAuth IDs are not credentials.

## Commands (run from a terminal for setup)

```powershell
node --experimental-strip-types D:/FOREX_TRADING/trade-os/integrations/mcp/cli.mts login --config D:/path/to/public-config.json
node --experimental-strip-types D:/FOREX_TRADING/trade-os/integrations/mcp/cli.mts status --config D:/path/to/public-config.json
```

`login` opens normal browser consent and listens only on the registered
127.0.0.1 callback. Already-approved access may resume without another approval
form; do not revoke/remap merely to make that form appear. The browser receipt
means the code was received; terminal success additionally verifies the signed
token and a live authenticated tool listing. Refusing consent is explicit.
Consent times out after three minutes. Codes/verifiers remain only in memory.

Configure the client to launch **Node directly**, not `npm run`, PowerShell,
an interactive shell or a login command. Those can pollute protocol stdout.
Generic launch specification (adapt its enclosing syntax to the actual client):

```json
{
  "command": "C:/nvm4w/nodejs/node.exe",
  "args": [
    "--experimental-strip-types",
    "D:/FOREX_TRADING/trade-os/integrations/mcp/cli.mts",
    "run", "--config", "D:/path/to/public-config.json"
  ]
}
```

Resolve the actual Node path on that machine. Client processes need Python on
PATH and their normal `LOCALAPPDATA`/`SystemRoot` environment. No tokens or AI
keys are supplied in client settings. `run` never silently opens consent.
Logs/errors go to stderr; stdout is official SDK JSON-RPC only. Modern and
legacy protocol versions use the same remote commands. EOF/SIGINT/SIGTERM
close the adapter and release its helper/credential lock.

## Credentials, concurrency and recovery

Records live outside Git under `%LOCALAPPDATA%/TradeOS/credentials/<derived-id>.dpapi`.
The ID and DPAPI entropy bind profile, resource, issuer and client. Files have
protected current-user/SYSTEM ACLs, encrypted atomic replacement and a real
OS-owned lock. One running adapter per profile prevents refresh-token races;
use separate registered clients/profiles for simultaneous clients. The lock is
released on process death. There is no plaintext or non-Windows fallback.
Native buffers are cleared by the shared utility; immutable Python/JS strings
and an already-downloaded result cannot be guaranteed erased from memory.

Renewal occurs before expiry and is serialized in-process. Before requesting
rotation, the old durable record is atomically marked disconnected. New tokens
are signature/resource/client validated before encrypted persistence. If the
network/process/disk fails mid-rotation, reconnect with `login`: restarting must
not replay a potentially consumed secret. This sacrifices unattended renewal
after an uncertain refresh in favor of a clear, fail-closed recovery boundary.

```powershell
node --experimental-strip-types D:/FOREX_TRADING/trade-os/integrations/mcp/cli.mts refresh --config D:/path/to/public-config.json
node --experimental-strip-types D:/FOREX_TRADING/trade-os/integrations/mcp/cli.mts disconnect --config D:/path/to/public-config.json
```

`disconnect` clears **local** credentials only. Revoke the application grant in
Settings > Integrations separately for immediate server-side denial. Normal
browser sign-out does not revoke approved integrations. Remote resources are
not served from the adapter's cache after disablement/revocation.

No automatic retry is made after an uncertain write or refresh. Keep the SAME
durable `operationId` and unchanged payload. Query `tradeos_operation_status`
before retrying a write; changing the payload under that ID is a conflict.
Database grants/ownership/version checks, protected planned-value corrections,
immutable reviews and browser-only permanent-deletion approval remain remote
and authoritative. Cancellation is forwarded, but is not a rollback guarantee.

## Verification

```powershell
npm run test:mcp-stdio
npm run test:mcp-python
npm run check:mcp-python
```

The stdio fixture requires the disposable local Supabase stack and integration
app from [the local runbook](../../docs/LOCAL_INTEGRATION_TESTING.md). It does
not use hosted credentials, user data, an MT5 terminal or a model API. Windows
verification must actually run on Windows; an unavailable environment is not
a passed gate. Real-client configuration/consent/read/write/refresh/revocation
and hosted activation remain the next separate build.

References: [MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports),
[Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).
