# Windows companion — packaging and consent checkpoint

Verified 2026-10-12 on feature/mcp-access, based on ba58810.
Scope: [Windows companion plan](WINDOWS_COMPANION_PLAN.md), delivery substeps 1–2
and the MT5 consent adapter portion of substep 3. **Not completion of app-led setup
increment 2, public distribution, the vendor-client matrix or production activation.**

## Delivered

- Native per-user Windows x64 installer, setup GUI and MCP console launcher.
  User-selectable local drive; immutable protected version directory. Installation
  creates no grant/task, opens no terminal, places no broker order and resumes no
  collector. Existing profile, vault and outbox stores stay outside install folders.
- Bundled Node 24.21.0, CPython 3.13.16, MetaTrader5 5.0.6231 and NumPy 2.5.3
  win-x64/cp313 runtimes. Public source inputs have pinned SHA-256; runtime and
  dependency licenses are retained. 957 files and the 14-package SDK dependency
  closure are included. No user checkout/global Node/Python/npm/pip dependency.
- Strict app-generated public bootstrap import with owner/account/resource/client
  constraints, fixed loopback ports, pinned HTTPS issuer/application origins,
  duplicate-key/nonfinite/unknown-field/secret rejection and bounded file sizes.
  Protected atomic writes reject changed-profile overwrites; identical retries
  preserve configuration. Local quota is 100 across profiles (server ownership
  quota remains its separate 20-profile rule).
- Explicit browser consent, reconnect and live access verification reuse existing
  MCP/MT5 OAuth and DPAPI. Importing configuration never supplies application access.
  Broker mapping/collection is not inferred from successful account authorization.
- Console launcher uses only protected imported MCP profiles, bundled runtime
  paths and fixed argument dispatch. GUI copies public command/arguments, not
  incorrect one-size-fits-all vendor JSON or unrelated configuration replacement.
- Child environment excludes NODE_OPTIONS/PYTHONPATH and inherited provider keys.
  Owned processes are bounded and contained; raw credential/provider errors are
  not displayed. Busy actions also lock the profile selector; switching a profile
  resets previous verification copy.

## Defects caught and corrected

The native serializer returns arrays as IList, not always object arrays.
Installer/profile loading now handles the real Framework result. Long installation
paths needed a Framework 4.8 target attribute as well as the per-process switches
and executable manifest; no machine-wide long-path policy/registry changes.

Package review found omitted shared token-verification/actor modules. They are now
compiled into the runtime inventory. The new actual packaged adapter test imports
these modules, exercises both protocol modes through real stdio subprocesses,
and verifies DPAPI/locking/restart with an isolated dummy payload.

GUI screenshots initially contained only the form background because the harness
had not materialized visible child handles. The harness now renders only this
project's own off-screen forms, waits for its fixture profile and checks child
handles and selector clipping. A responsive maximum-size constraint also collapsed
the fixed-height selector panel; fixed by constraining only auto-sized flow panels.
Wrapped actions grow vertically rather than clipping a row.

| Before | After | Why |
| --- | --- | --- |
| Developer checkout/global runtimes required | Bundled runtimes and native installer | App-led setup cannot depend on developer tooling |
| Imported public file could be mistaken for access | Explicit configured/authorized/observed separation | No fabricated grant or healthy worker |
| Fixed-width actions and shrinking selector | Responsive copy/actions, fixed-height selector and vertical scroll | Keep controls visible at the supported minimum window size |
| Profile selection remained available while busy | Selector locked with pending actions | Avoid showing one profile's verification against another |
| Generic vendor configuration copied | Exact public launcher command/arguments | Client formats differ; actual registration is a separate gate |

Emil design review informed the restrained navy/amber typography, native keyboard
controls and state clarity. Native patterns were imprinted into ui-registry.md;
no new web theme tokens or motion dependencies were introduced.

## Exact commands and results

| Command | Result |
| --- | --- |
| npm run prepare:companion-runtime | Pinned public runtime inputs downloaded/verified; one Python download used the Windows HTTPS client after the Node request timed out, with the same published SHA-256 |
| npm run build:companion | PASS; self-contained unsigned test EXE/ZIP, bundled-runtime imports/version smoke checks |
| npm run test:companion-python | 24/24 PASS |
| npm run check:companion-python | Ruff and Python compilation PASS |
| npm run test:companion-native | 34/34 PASS against the final real bundle |
| npm test | 64 files, 1,127/1,127 PASS |
| npm run test:mt5-python | 176/176 PASS |
| npm run test:mcp-python | 6/6 PASS |
| npm run check:mt5-python | PASS |
| npm run check:mcp-python | PASS |
| node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm --pending-migrations | npm run test:db -- --pending-migrations: all 28 suites PASS; unchanged 1,121-assertion suite set |
| npm run typecheck | PASS |
| npm run lint | PASS, no warnings; repeated after packaged test additions |
| npm run build | PASS, Next.js 16.3.8; public calculator remains static |
| git diff --check | PASS |

Native builder/test host: Windows 11 Pro 10.0.26200, Framework 4.8.09221
(release 533509); compiler is the already installed Framework x64 csc.
Builder Node 25.1.0 is not the user's runtime; installed tests use bundled
Node 24.21.0 and CPython 3.13.16 with an isolated environment.
MCP SDK client/server 2.3.1; actual local stdio fixture tests legacy and pinned
2026-07-28 negotiation, paging, decimal strings, nulls, protocol-only stdout,
Windows DPAPI, competing-profile exclusion and restart. Its remote service is an
offline fixture, not a real AI client or hosted grant.

Final ignored artifact: .artifacts/companion/build-1791833228975-setup.exe.
SHA-256: A7C2810C91A887913E3A9338A8E02C515FEFBCE488A7D504AF276657F00A8B88.
Manifest state UNRELEASED. A checksum is byte-integrity evidence, **not** a
publisher signature or permission to bypass SmartScreen/security warnings.
Final native fixture: .artifacts/companion/fixtures/1547df69-c698-4109-8f21-c2de35d8dc88.
Rendered screenshots are retained there; these contain dummy setup only.

Database tests use disposable local Supabase, pending schema per suite transaction
and rollback. The established diagnostic-hint helper temporarily suppresses local
hint comments and restores the original setting; permissions are not weakened.
No hosted migration, resource policy or user data changed. Build hashing uses a
180-second offline-build bound for cold disk/antivirus I/O; application, authentication,
collector and native-test deadlines were not increased to make failures pass.

## Review and remaining gates

Plan alignment: PASS for this packaging/consent checkpoint; **incomplete** for
full increment 2. System integrity: PASS; shared domain/OAuth/DPAPI implementations
are reused, not replaced. Production readiness: NOT RELEASED.

Before full app-led setup is complete:

1. Explicit dedicated-terminal selection/demo identity probe and browser pairing.
   Existing mapped accounts need audited adoption/rebinding without duplicating a
   connection, losing outbox state or defeating lease fencing.
2. Approved mapped-manifest import and PAUSED collector initialization, then explicit
   start/pause/recovery/startup GUI controls and local pending-upload telemetry.
3. Real app-generated consent with the final installed companion and hosted setup
   prerequisites; verify standard-user installation/upgrades, supported Windows
   versions and Windows security/distribution behavior. No user install happened
   during the isolated test.
4. Actual Codex write/retry/concurrency/revocation acceptance, Claude Code, Gemini
   CLI and supported remote connectors. SDK fixtures are not that client matrix.
5. Separate artifact publication, hosted setup enablement and final integration
   rollout approval. No production MCP enablement or MT5 resumption is implied.

There were no financial calculations, canonical trades, broker facts, grants,
production flags, tasks or existing terminal settings changed in this checkpoint.
The existing paused USD100K DEMO pilot was not touched. VPS provisioning and the
previously deferred extended soak remain outside this delivery.
