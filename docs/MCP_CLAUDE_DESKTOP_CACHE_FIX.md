# Claude Desktop installation-integrity fix — 2026-10-14

## Cause and scope

The owner's installed Desktop extension could not connect. Read-only inspection
confirmed the selected Desktop JSON was valid and exactly matched its imported
public setup. The pinned companion files matched, but normal companion use had
generated 13 unlisted Python `__pycache__/*.pyc` files. The strict Desktop launcher
therefore correctly rejected that installation as `MODIFIED_COMPANION`.

The defect was in packaging/runtime behavior, not the user's selected JSON or
authorization. The previous gates checked the sealed installation before imports,
but did not re-check it after normal setup and credential-store activity.

All owned Python launch paths now explicitly use `-B`: native setup IPC, MCP
credential-store shim, companion collector launch, bounded MT5 worker and newly
generated startup specifications. `-I` ignores Python environment overrides, so
an environment variable alone is not an adequate fix. Existing exact legacy
startup arguments remain recognizable for inspection/disable/explicit repair;
other argument, identity and executable changes remain rejected. No installed
task was inspected, enabled, repaired or changed by this delivery.

The extension still pins the manifest, hashes every listed file and rejects
unlisted executable bytecode. No integrity exception, credential change, broader
grant, local installation patch or cache deletion was introduced. Extension
version is now `0.1.1`; both replacement files must be downloaded through the
application and used as a matched pair in a new version directory.

## Verification

| Exact command / gate | Result |
| --- | --- |
| `npm test` | 69 files, 1,207 tests passed |
| `node .artifacts/claude-desktop/local-db-check.mjs` (wraps `npm run test:db -- --pending-migrations`) | 30 rollback-isolated suites, 1,184 assertions passed; local diagnostic setting restored |
| `npm run test:companion-python` | 44 passed |
| `npm run check:companion-python` | Ruff and compilation passed |
| `npm run test:mt5-python` | 190 passed, including exact legacy startup ownership |
| `npm run check:mt5-python` | Ruff and compilation passed |
| `npm run test:mcp-python` | Six protected-vault tests passed |
| `npm run check:mcp-python` | Ruff and compilation passed |
| `npm run build:companion` | Node 24.21.0, Python 3.13.16; 961 files, 14 dependencies |
| `npm run test:companion-native` | 84 checks: 15 installation + 69 runtime; no caches after actual IPC/vault/worker imports |
| `npm run build:claude-desktop` | Full sealed inventory verified before and after packaged Python imports |
| Official cached `@anthropic-ai/mcpb@2.1.2` CLI: `validate …/manifest.json`, `info <artifact>` | Schema and archive accepted; explicitly unsigned |
| `npm run typecheck` | Passed after generated-route recovery |
| `npm run lint` | Passed |
| `npm run build` | Passed, Next.js 16.3.8 |
| `node .artifacts/claude-desktop/hosted-readonly-check.mjs` | Eight public-page/discovery/anonymous-denial checks passed after staging activation |

The MT5 suite initially reported two old exact-argv test expectations omitting
the new `-B`; those assertions were updated and all 190 tests passed unchanged
in scope and deadlines. A typecheck initially found truncated/duplicated generated
development route files, unrelated to this source fix. Only the two generated
files were moved to a retained workspace artifact backup; `npm exec -- next typegen`
regenerated route types and typecheck/build passed. No application files or user
installations were deleted. The official MCPB CLI was also invoked directly from
its verified local 2.1.2 installation to avoid depending on registry availability.
The initial sandboxed database invocation lacked Docker access; its authorized
local-only run passed. The existing Supautils denial-hint workaround temporarily
disabled only crashing diagnostics and restored them afterward; hosted data,
RLS, permissions and schema history were not changed.

A read-only preflight ran the **new packaged extension launcher** with the owner's
existing Desktop setup and protected authorization. Legacy MCP initialization,
discovery of 84 tools and eight resources passed. The complete pinned inventory
still verified afterward. It did not invoke model APIs or application mutations,
change other clients, install the extension into Claude, or prove Desktop Chat
write/restart/revocation acceptance.

## Replacement artifacts

- Companion: 59,186,176 bytes, SHA-256
  `532bb12fcaacbb4b981e70c2bc5ae176ccd940f77098c9fcb180ad367a32d1d0`.
- Companion manifest SHA-256:
  `ea33b4fb34e21fab55b09ae1e1e18fb6859ac930016c69d8c93d2cfdb21fb34d`.
- Desktop MCPB 0.1.1: 9,715 bytes, SHA-256
  `7ef06b4ee928474206f0e63d8b14a312f7f111ec6ce083cc0e3d82d8c37cfb8d`.

Published matched prerelease: `companion-preview-20261014-302ac62`, target
`302ac62f4bdfec31fec4304b74f7f08a2afaefa9` on `feature/mcp-access`.
Both GitHub server checksums and complete re-downloaded asset hashes match the
values above. The 59 MB authenticated CLI download completed slowly; a parallel
public curl check timed out after 120 seconds with a partial copy and was not
accepted as verification. The public download HEAD returned 200. No user
installation or old artifact was overwritten.

Only six public release-metadata values (two tags, hashes and sizes) were
upserted and read back for Preview / `feature/mcp-access`. Onboarding/auth flags,
secrets and production configuration were not changed. Configured deployment
`dpl_3BoHvez2aR18oJqiXU1yhHpV2Um3` is READY, target `staging`, at source `302ac62`;
its database preflight passes 48 functions and 14 version/order columns. The
existing `mcp-preview.veilcode.studio` alias was assigned only to this verified
staging build. Production was independently read back at
`dpl_AYWaAcshMdA24AekiNPnADJFEhU2` / master `b01c085`, with MCP disabled;
this delivery did not merge, redeploy, promote or enable production.

Actual Claude Desktop acceptance remains pending; the previous extension's
installation screenshot is evidence of the failure, not a passed client gate.
Production, Codex, Claude Code and MT5 grants/collector state remain out of scope.

## Owner retest

Use the existing saved Desktop setup page, not a new authorization/profile.
Download the replacement companion and extension together. Install into its new
`companion-ea33b4fb34e21fab` directory. Update/reinstall the Desktop extension with
the new MCPB, select this new companion folder and the same Desktop setup JSON,
then re-enable only this extension. The protected setup and authorization live
outside the installation; no revocation or repeat consent is required unless
the connection explicitly requests it. Preserve the old installation and all
other clients/MT5. Confirm the red startup banner disappears and Desktop Chat
can discover the Trade OS tools before continuing its broader acceptance gates.
