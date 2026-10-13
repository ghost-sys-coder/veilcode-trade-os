# MT5 companion — reviewed terminal pairing

Verified 2026-10-13 on feature/mcp-access, extending f363351.
This is the pairing/PAUSED-activation checkpoint of app-led setup increment 2,
**not** public installer release, running/startup controls, real-terminal
acceptance, the MCP client matrix or production activation.

## Delivered

- Companion explicitly selects one dedicated terminal64.exe or the operator's
  existing PAUSED connection.json. A confirmation explains that SDK initialization
  may open the chosen installation. No installation discovery, saved-login
  enumeration, passwords, account switching, history capture or execution API.
- Metadata-only demo probe reuses the collector's complete identity verifier:
  broker server, string login, demo/live state, hedging/netting, exact installation/
  data folder and account currency precision. Repeated checks reject switches
  during the probe. Current balance, equity, stops and plans are not fabricated.
- Credential-free protected review file and separate local adoption record.
  The GUI copies its file path; the authenticated app previews the exact identity
  and paths, requires a recent observation (15 minutes), reason and unchecked
  acknowledgement, then approves through a private atomic workflow.
- Public wrappers are security invoker; private table has RLS and no direct
  browser/OAuth/anonymous/service-key writes. Approval verifies direct browser
  session, owned READY setup, active exact grant/resource/account/currency,
  setup policy and optimistic versions. Durable operation hashes/results/audits
  reject changed retries and roll back together with mapping changes.
- New mapping reuses the existing registration service. Existing mapping requires
  its exact connection ID/version/terminal identity, PAUSED status, no attention,
  no live lease and no incomplete server collection. Native adoption also requires
  the original local manifest, zero pending uploads and unchanged file hash.
  It preserves connection/trade identities and the entire SQLite spool; the server
  advances fencing once, binds the explicitly approved grant and clears worker/
  lease/heartbeat ownership. It does not revoke unrelated grants or resume anything.
- Owner-only mapped download and account/resource-bound collector approval lookup.
  Changed account precision/currency, revoked or superseded grants invalidate
  activation. Native import compares server approval to the protected original
  proposal, verifies the terminal again and creates/reuses only a PAUSED spool.
  Adoption replaces only the selected public manifest atomically under worker lock.
- MCP profiles cannot invoke MT5 probe/adoption/import controls. Profile reads
  lazily avoid loading pairing/operator modules. No startup task is installed.

## Verification

| Command | Result |
| --- | --- |
| npm test -- --maxWorkers=1 | 65 files, 1,136/1,136 PASS |
| node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm --pending-migrations | All 29 disposable rollback-isolated suites PASS; pairing initially 38/38 |
| Same database command with --suite=mt5_pairing.test.sql after final currency guard | 40/40 PASS; baseline 1,121 plus pairing 40 assertions |
| npm run test:integration-setup | 7/7 local real-provider/browser checks PASS; fixture cleanup/restoration PASS |
| npm run test:companion-python | 30/30 PASS |
| npm run check:companion-python | Ruff/compilation PASS |
| npm run test:companion-native | 15 installation + 20 runtime/GUI checks PASS |
| npm run test:mt5-python | 176/176 PASS |
| npm run test:mcp-python | 6/6 PASS |
| npm run check:mt5-python / npm run check:mcp-python | PASS |
| npm run typecheck | PASS |
| npm run lint | PASS, no warnings |
| git diff --check | PASS |
| npm run build | PASS, Next.js 16.3.8; both pairing routes present; calculator static |
| npm run build:companion | PASS, 958 files / 14 runtime dependencies; Node 24.21.0 / Python 3.13.16 |
| supabase db advisors --local --level warn --type all --output json | Completed; existing auth_rls_initplan performance warnings on legacy direct-browser policies remain. Pending pairing schema was not permanently installed, so this is not an advisor certificate for that migration |

Pairing SQL tests include owner/anonymous/OAuth denial, acknowledgement, unsafe
paths, live/mismatched/stale identity, durable/changed retries, audit-failure
rollback for registration and adoption, superseded/revoked activation rejection,
one preserved connection, unchanged paused state and exactly one fence advance.
Python fixtures prove no login/order/history invocation, switches during reads,
wrong precision/mode rejection, activation replay and byte-for-byte logical
SQLite preservation across same-manifest adoption.

Browser uses an actual local provider for public registration and the authenticated
app for review/approval/download. Its pairing grant is deliberately fixture-seeded
to represent completed consent; **this does not prove a new real-terminal OAuth
approval**. No MetaTrader terminal is opened. Dark 390px pairing layout/download
and existing light/dark registration/mobile regression are verified without console
errors. The new native runtime gate retains actual legacy/2026-07-28 stdio protocol
and DPAPI fixtures; it is not Codex/Claude/Gemini acceptance.

## Failures and targeted fixes

The adoption test kept sqlite3 handles open because its context manager commits
but does not close them. Explicit closing fixes cleanup; logical spool equality
was already correct. Rapid browser file reads now have a generation guard.

Three monolithic native runs exceeded the original 60-second aggregate harness
limit at different stages. They are failures, not passed evidence. Installation
and runtime are now separate processes, each with a 60-second test bound;
the aggregate allowance is therefore larger. Individual 30-second IPC/runtime/
GUI and authentication/collector deadlines are unchanged. The passing measured
phases took 48,177 ms and 21,052 ms respectively (69,229 ms combined).
Same-version refusal now avoids unnecessarily decompressing an existing version
merely to reject its overwrite; new installations retain full hash validation.

The isolated installation also hit an IOException at final directory rename;
the same staged fixture moved successfully later, without permission changes.
Finalization retries only Windows sharing/lock violations (32/33), three times
with 100/200/300 ms delays. Disk-full, permission, invalid-path and destination
conflicts fail immediately. No security exclusion or machine policy was changed.
Native diagnostics expose exception type/HRESULT/source line, not credentials.

The final installer was recompiled with the existing Framework x64 compiler from
Installer.cs + Compatibility.cs and the same verified bundle ZIP, without rebuilding
or modifying the runtime payload. Arguments: /platform:x64 /target:winexe
/main:TradeOS.Companion.InstallerProgram, app.manifest, System.Windows.Forms,
System.Drawing, System.Web.Extensions, System.IO.Compression and embedded
TradeOS.Payload. Final ignored artifact:
.artifacts/companion/build-1791853462269-pairing-setup.exe.
SHA-256: 54AA8830A33C1BCAFD3C0B60D2AC73A947A11B4AF03538EF8C30E13A47D29EDB.
Native fixture: .artifacts/companion/fixtures/1cee1a5c-7181-4b50-911c-bd3b145d8991.
Installer remains unsigned/UNRELEASED; no actual user installation occurred.

## UI and architecture review

| Before | After | Why |
| --- | --- | --- |
| No terminal mapping step | Exact identity/path preview, reason and explicit acknowledgement | Configuration is not permission or verified broker identity |
| Normal register would conflict with an existing account | Explicit paused same-terminal adoption | Preserve canonical identities, fencing and existing spool |
| File reads could finish out of order | Latest-selection generation guard | Avoid approving a different file than the selected one |
| Mapping alone could imply a healthy collector | Explicit PAUSED state and separate history/activity guidance | Never fabricate heartbeat or reconciliation |
| Both purpose workflows loaded operator code | Lazy MT5-only pairing imports and disabled MCP controls | Preserve integration isolation and startup responsiveness |

Shared web primitives/native navy-amber patterns are imprinted in ui-registry.md.
No new themes, animations, financial arithmetic or source-specific trade model.
Plan alignment: PASS for this checkpoint; full increment 2 remains incomplete.
System integrity: PASS for the tested owner/grant/fence/audit boundaries.
Production readiness: NOT RELEASED; hosted schema/flags remain unchanged.

## Remaining

1. Companion running/start/pause/recovery/startup UI and local health/pending-upload
   telemetry, with explicit opt-in and real operator acceptance.
2. Approved hosted prerequisite rollout, standard-user final installer/real demo
   pairing test and release/distribution verification. Windows 10 is not proved by
   this Windows 11 test; unsupported terminal/adoption paths remain held.
3. Actual Codex write/retry/concurrency/revocation, Claude Code, Gemini CLI and
   supported remote connector acceptance, then separate production activation.

Existing USD100K DEMO pilot, twenty trades, outbox, grants, task, manually used
terminal and hosted policies were untouched. Local schema tests roll back; the
browser fixture removes only its generated records/schema and restores policies,
legacy RPC definitions and the diagnostic-hint setting. No migration history
entry was applied. Local test server was stopped.

Official behavior references: [MT5 initialization](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)
and [account metadata](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py).
