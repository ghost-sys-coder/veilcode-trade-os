# Companion local controls — 2026-10-13

Branch: `feature/mcp-access`, fast-forwarded to consolidated `master` `5895ded`.
Checkpoint: local controls/telemetry implemented and locally verified. This is
not public installer release, hosted activation or real-client acceptance.

## Delivered

- Protected, immutable profile-to-manifest receipt created after reviewed PAUSED
  activation. Reopening needs no terminal rediscovery. Hash/owner/account/client/
  issuer/resource/callback checks reject drift before controls. Pairing replays
  cannot silently retarget an already activated profile; adoption now also requires
  the coordinator lock to be free before replacing its public manifest.
- Fixed native IPC exposes local health, reasoned start/recovery, offline pause
  and separate startup inspection/install/owned repair/disable. MCP profiles cannot
  operate MT5. No arbitrary runtime/process/path command, PID/name killing, order
  API, new application service or financial calculation is introduced.
- Start rechecks live account-bound access and current server pairing, reuses
  existing resume/coordinator/outbox/lease workflows, and launches only sibling
  bundled `pythonw.exe` with fixed isolated arguments and sanitized environment.
  Pending uploads drain first. A five-second observed startup handshake is not
  proof of upload/publication/reconciliation. Failed/unconfirmed launch returns
  local intent to PAUSED; stale held locks require inspection, not force restart.
- Hidden worker can outlive GUI closure. Pause persists an append-only reason and
  stops subsequent work; a bounded in-flight capture/upload can finish first.
  Local pause works without network or active authorization. Server pause/resume,
  snapshot approval and publication remain separate browser workflows.
- Protected atomic local observations include connection/generation, UTC tick,
  state and redacted code only. A held lock, recent same-generation tick, server
  contact, durable intent and pending pages remain distinct. Missing/corrupt/
  oversized/future/stale/previous-generation observations never imply healthy
  activity. Tick observations refresh at 15-second intervals/state changes; UI
  snapshots require explicit refresh. Stale boundary remains 120 seconds.
- Startup is a separate confirmed opt-in requiring local PAUSED intent. Existing
  current-user InteractiveToken/least-privilege sign-in/watchdog specification is
  reused. No /Run, boot or SYSTEM trigger is added. Inspect/repair/disable verify
  exact user/interpreter/arguments/config/working directory and single action.
  Query failure is UNKNOWN, not guessed absent. Disable pauses and verifies
  disabled state, without deleting tasks or data. Repair can re-enable the exact
  owned task; unrelated or old-interpreter tasks require explicit inspection.
  Immutable protected operation-ID/reason intent and completed/unconfirmed files
  record the nontransactional OS boundary; no automatic uncertain-write retry.

## Commands and results

| Command | Result |
| --- | --- |
| `npm test -- --maxWorkers=1` | PASS: 1,136 tests / 65 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm --pending-migrations` | PASS: all 29 local database suites via `npm run test:db`; two existing pending setup migrations injected transactionally, schema/history unchanged; local diagnostic hint restored |
| `npm run test:companion-python` | PASS: 44 tests |
| `npm run check:companion-python` | PASS: Ruff and compileall |
| `npm run test:mt5-python` | PASS: 189 tests |
| `npm run check:mt5-python` | PASS: Ruff and compileall |
| `npm run test:mcp-python` | PASS: 6 tests |
| `npm run check:mcp-python` | PASS: Ruff and compileall |
| `npm run build:companion` | PASS: pinned runtime imports, 960 inventory files, 14 dependency packages; unsigned UNRELEASED artifact |
| `npm run test:companion-native` | PASS: final 15 installation + 41 runtime/UI checks; 28,836 ms + 15,869 ms, unchanged separate 60-second phase bounds |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next.js 16.3.8; anonymous calculator remains statically rendered |
| `git diff --check` | PASS |

Bundled versions: Node 24.21.0, CPython 3.13.16, MetaTrader5 5.0.6231,
NumPy 2.5.3. No real vendor client was exercised in this checkpoint.
Final private build: `.artifacts/companion/build-1791857228118`.
Installer SHA-256:
`87A633E0FD9E3A688A7865CD507C6E0F473537A7FAEAC61B03BAA417B0F002C0`.

Native fixture: `.artifacts/companion/fixtures/b97a9455-7baa-42ea-a781-9699d3451ca0`.
The real packaged coordinator ran PAUSED against a fake non-executable terminal
file, with no provider token, SDK calls, network or task registration. It survived
the parent IPC job closing and stopped on a six-second test-only deadline.
Packaged-health test code is copied into the fixture, never distributed.
SDK stdio/DPAPI/restart fixtures remain offline and are not actual client acceptance.
Own-form screenshots at minimum size, including scrolled control regions, were
inspected under `.artifacts/companion/screenshots/controls-*.png`.

Initial control fixtures failed because mocking the API still constructed a real
OAuth vault; mocking that constructor isolates the tests correctly. Initial Ruff
failures were unused/import-order issues, corrected without relaxing checks.
An imported test class also doubled discovery; module-qualified fixture reuse
removed that duplication. Final counts above exclude duplicates. No failed check
is relabelled passed and no operation/test deadline was increased.

## Review

Plan alignment: PASS for the selected local-control checkpoint. Existing collector,
supervision, startup and permission boundaries are reused, not rebuilt.
System integrity: PASS; no hosted/schema/security policy changes, no secrets in
IPC/telemetry/audits, and no arbitrary owner/process dispatch. Review of the native
layout used the existing UI registry and design-engineering patterns:

| Before | After | Why |
| --- | --- | --- |
| No local control section | Labelled reason and wrapped native controls | Explicit intent and consistent navy/amber layout |
| Potential fixed-width reason field | Field follows viewport width | No minimum-size horizontal clipping |
| Generic request failure | Uncertain acknowledgement directs status inspection | Avoid blind retries of OS/durable writes |
| Saved intent alone | Separate lock/tick/contact/pending state | Prevent false online/healthy claims |

Checkpoint readiness: PASS for source delivery. Public/operational release remains
PENDING, not passed. No known code defect remains in the selected checkpoint.

## Unchanged boundaries and next gates

No hosted migration/flag/secret, grant, real task, pilot spool, broker terminal,
order, canonical trade or balance was modified. Production MCP/setup remain
disabled; USD100K DEMO was not adopted/resumed. Private artifacts are ignored,
unsigned and unpublished. Supabase/browser protocol checks from the previous
pairing report were not rerun or claimed newly passed: no browser/API/schema code
changed here. All local database regressions were rerun.

Next: separately approved hosted setup prerequisites/private installer delivery
and real standard-user installation/terminal/startup acceptance, then actual Codex
writes/retries/concurrency/revocation, Claude Code, Gemini CLI and supported remote
connectors. Windows 10, cold startup/sign-in/reboot and the packaged worker against
the approved real demo terminal are still PENDING. No extended soak, public signing,
VPS purchase or production MCP activation is inferred from fixture success.

Implementation references: [Windows job ownership](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[task disable semantics](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-change),
[Supabase OAuth](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).
Existing live-grant/resource/refresh enforcement remains unchanged.
