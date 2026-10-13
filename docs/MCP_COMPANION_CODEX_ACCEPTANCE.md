# Packaged companion / Codex acceptance — 2026-10-13

Subsequent configuration mutation/retry/concurrency and fresh-process replay
checks pass; live revocation and broader client acceptance remain pending. See
[mutation checkpoint](MCP_CODEX_MUTATION_VERIFICATION.md). Earlier pending notes
below describe the installation/registration checkpoint, not a request to repeat it.

The user completed browser approval and application verification with the app-led
Codex profile `2638fa90-01f6-4450-b3ae-a88eefe51304`. Public client ID
`b4db4c19-015d-4431-b9d2-6b534deeed6e`, callback 127.0.0.1:9878, staging MCP resource.
The provided screenshot reports a verified real MCP connection. This records the
successful owner consent/GUI verification gate for the published browser fix.

## Native stdio defect caught during client acceptance

The installed adapter invoked directly exposed all 84 tools / eight resources,
while the native TradeOSMcp.exe wrapper timed out with no protocol output.
Its interactive pipe forwarding did not flush small messages before stdin EOF.
This blocked request/response initialization although finite GUI status commands
worked. Independent worker tasks now start every direction, and every forwarded
chunk is flushed. Protocol bytes, separate stderr, ownership and shutdown rules
are preserved.

The native fixture now round-trips both legacy and modern SDK clients through
the same native relay implementation, with a mock server and no network/grants.
The unflushed intermediate candidate failed that new runtime gate. The repaired
candidate passes; no operation/test deadline was enlarged.

## Verification

| Check | Result |
| --- | --- |
| `npm run build:companion` | PASS: build-1791901372487, 961 files / 14 dependencies |
| `npm run test:companion-native` | PASS: 15 install / 67 runtime/UI checks, including native relay protocol round trips |
| `npm run lint` | PASS |
| Live SDK check of candidate TradeOSMcp.exe | PASS: 84 tools / eight resources |
| Actual Codex CLI 0.147.0 discovery | PASS: 84 tools / eight resources; zero protocol errors |
| Actual Codex account/catalog reads | PASS: owner account page and capabilities catalog |
| Actual Codex resource reads | PASS: domain, money, workflows, catalog |

Native Codex uses the candidate packaged launcher and the already approved public
profile. Only that server is enabled for each bounded process. No global client
configuration was written, no model turn/inference was requested, no provider key
was loaded into the harness environment and no application mutation was called.
The model endpoint is an unused loopback address. Private account data stays in
memory; receipts contain booleans/counts only.

Early probe configuration failures are not passes: partial disabled-server
overrides produced invalid transport tables, then a mixed HTTP/stdio override
conflicted with inherited entries. Complete entries retaining transport types
fixed the harness. Original wrapper discovery then timed out; the direct adapter
comparison isolated the product relay defect. The final actual-client reads passed
despite non-protocol stderr categorized as missing/socket; no warning-free entire
Codex session is claimed.

Public candidate: 59,186,176 bytes; SHA-256
`64aa6d1a5627b5902fcc48530f4d3324168722824272ba7336e0c45dc3df4bbe`.
Manifest revision / final install folder: `companion-eb9c5f33c5b03974`.

Application publication and installed-user retry are complete for this Codex profile.
Actual client writes, retry/concurrency/revocation and the remaining client matrix
are still pending. Previous source-adapter acceptance is not counted as this
packaged path's acceptance. Existing MT5 grants, terminal/collector/startup state
were not modified. No local-folder replacement is part of delivery.

## App download release

Source `a2d93758fca074dea0e4d28ba053b996890cc359` is pushed. Public prerelease
`companion-preview-20261013-a2d9375`, asset ID `637303626`, matches the recorded
size and checksum. It is not Latest. Updated and exactly read back only the three
Preview artifact-metadata values on `feature/mcp-access`. Requested fresh
deployment `dpl_5nrH8zghDdHa2xy7JN1FxFai8yxg` after updating those values.
The existing saved setup page supplies the pinned installer download; the user's
existing public configuration and approval remain usable.

Deployment `dpl_5nrH8zghDdHa2xy7JN1FxFai8yxg` reached READY on the recorded
source commit. An independent lookup of `mcp-preview.veilcode.studio` resolved
to that exact deployment. Its build prerequisite check passed: 46 functions and
14 version/order columns. A complete anonymous download of the public installer
returned HTTP 200 and matched both 59,186,176 bytes and the recorded SHA-256.
Production MCP remains disabled; no production promotion was performed.

## Installed-user gate completed

Refresh the saved application setup page and download the current Windows
companion there. Close the old companion, install into the same parent folder,
then launch from `companion-eb9c5f33c5b03974` and select the existing Codex setup.
No local install files were patched by the agent. No renewed consent is required
unless the connection explicitly reports that approved access is missing.

The user reported successful verification after installing the current app
download. Read-only checks confirm the installed manifest SHA-256 and native
launcher bytes exactly match the published candidate. No installed files were
patched by the agent.

## Persistent Codex registration

Codex CLI 0.147.0 was registered using its supported `mcp add` command as
`tradeos_staging`, pointing to the installed `TradeOSMcp.exe` with `--profile`
and the existing profile ID. All eight prior MCP entries were preserved. The
initial preservation harness used order-sensitive JSON equality and rejected
the result; canonical key/entry ordering and exclusion of dynamic auth status
corrected that diagnostic. Only the just-added exact launcher entry was removed
and re-added for verification. No OAuth grant was revoked or replaced.

The read-only installed-client check passed account/catalog and four resource
reads before registration. After registration, the verified exact target passes
actual Codex discovery of 84 tools and eight resources, with zero protocol errors.
Registered installed-client account/catalog and four resource reads also pass.
Other configured servers are disabled only in each temporary test process; the
user's persistent entries remain enabled/disabled as before. No model turn or
provider API call was made. Controlled writes/retries/concurrency/revocation and
the remaining client families are still pending; production MCP stays disabled.

Exact bounded commands for this checkpoint (ignored local diagnostic helpers):

- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --read`: PASS.
- `node .artifacts/mcp-clients/register-installed-codex.mjs --verify-and-reregister`: PASS, eight existing entries preserved.
- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --registered --discover`: PASS, 84 tools/eight resources.
- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --registered --read`: PASS, account/catalog/four resources, zero protocol errors.
- `git diff --check`: PASS.

Protocol checks make no model calls; read checks retain the previously documented
non-protocol missing/socket stderr categories. No application code or schema was
changed at this checkpoint, so the full app/database/build suites were not rerun.
Registration follows the [official Codex MCP command documentation](https://learn.chatgpt.com/docs/developer-commands#codex-mcp).
