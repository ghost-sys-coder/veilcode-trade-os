# Claude Desktop Chat: app-led setup increment

Approved 2026-10-13. Branch: `feature/mcp-access`. This increment implements
Desktop **Chat** onboarding; it does not rebuild the completed Codex/Claude Code
adapters, canonical workflows or MT5 synchronization.

## Delivery and boundaries

- New `CLAUDE_DESKTOP` profile, account-free public OAuth registration and exact
  S256 loopback callback `http://127.0.0.1:9884/callback`. Claude Code stays on
  port 9880; existing profile IDs, callbacks and grants are untouched.
- App setup selector, owned credential-free JSON and owned extension-download
  endpoint. Installer and extension come from the application; no user-installation
  patches, hand-edited client configuration or AI-provider keys.
- Lightweight `.mcpb` Node launcher uses Desktop's supplied Node runtime to
  verify and start the matched `TradeOSMcp.exe`, forwarding the existing stdio
  adapter. No duplicated business logic or in-memory application sessions.
- The extension pins the exact companion manifest and checks **every** inventoried
  file, rejects added files and linked/remote/device/traversal/alternate-stream
  paths, and compares selected versus imported public setup before launch.
  Only Desktop's own profile is accepted; credentials stay in the existing
  protected vault, never the extension or public downloads.
- Separate application flag, default-off database Desktop policy and matched
  release metadata. Production MCP remains disabled. Disabling onboarding is not
  a revocation of existing grants; individual revocation remains authoritative.
- `list_integration_setups_v2()` supplies the new profile and policy state. The
  original RPC retains its old JSON shape and excludes the new enum, preserving
  older deployed code. Existing production consent services already use generic
  owner/resource-bound grants; no production consent-code change is required.
- Gemini is visibly ON HOLD, not advertised as verified. Desktop Code tab and
  remote/cloud connectors remain separate acceptance paths. No VPS provisioning
  or Windows task/terminal changes. Moving host/user needs destination consent;
  protected credentials must not be copied.
- Public `/integration-privacy` explains data handling without an authentication
  requirement. Both themes reuse the established tokens recorded in `ui-registry.md`.

## Verification completed locally

| Gate / exact command | Result |
| --- | --- |
| `npm test` | 69 files, 1,206 tests passed; final rerun 34.87 seconds |
| `npm run test:db -- --pending-migrations` | 30 rollback-isolated suites, 1,184 assertions passed |
| `npm run typecheck` | Passed sequentially |
| `npm run lint` | Passed |
| `npm run build` | Passed; Next.js 16.3.8, new download route and static public notice present |
| `npm run test:companion-python` | 44 tests passed; existing profiles and separate Desktop callback covered |
| `npm run check:companion-python` | Ruff and compilation passed |
| `npm run build:companion` | Verified Node 24.21.0 / Python 3.13.16, 961 files / 14 dependencies |
| `npm run test:companion-native` | 82 checks passed: 15 installation + 67 runtime checks |
| `npm run build:claude-desktop` | Sealed companion copy verified; exact packaged Python recognizes Desktop; MCPB built |
| `npm run test:integration-setup` | Eight provider/browser checks passed using the fixture release configuration; Chrome 154.0.8037.99 |
| `npm exec --cache .artifacts/npm-cache --yes --package=@anthropic-ai/mcpb@2.1.2 -- mcpb validate integrations/claude-desktop/manifest.json` | Official schema validation passed |
| Same pinned CLI, `mcpb info <built-artifact>` | Archive accepted, 9.48 KB; explicitly unsigned |
| `git diff --check` | Passed |

The browser gate used the existing isolated local app runner and temporary
setup/provider fixtures, extended to create and restore the Desktop migration.
It verified the distinct profile/callback, owner-only configuration and release
redirect, default-off policy, disabled Gemini, anonymous public notice, both
mobile themes, no horizontal overflow and existing MT5 pairing/CLI regressions.
It did **not** install an extension into the owner's real Desktop or call a model.
Screenshots were inspected in `.artifacts/integration-setup/claude-desktop-*-mobile.png`.

Database runs used the existing local test runner with all three pending local
migrations injected inside each rollback transaction. Supautils' permission-hint
formatter crashed on deliberate denials; container-local diagnostics were
temporarily disabled using the same existing provider-fixture workaround and
restored afterward. Permissions, RLS, assertions and hosted data were not weakened.
An initial all-suite failure identified a missing **explicit** browser guard in
the legacy compatibility function; the guard was restored and every suite passed.
A fixture initially updated a nonexistent MT5 policy row; its setup was corrected.

One concurrent typecheck attempt hit desktop memory exhaustion. Its sequential
retry passed unchanged after stopping the isolated verification server. A dev
compiler subprocess also logged memory exhaustion during the browser run;
all eight browser checks and cleanup nevertheless passed. These resource limits
are recorded, not hidden by longer application/test deadlines.

## Built artifacts (subsequent scoped publication recorded separately)

This local checkpoint preceded the approved staging release. For current
publication, hosted gates and owner acceptance, see
[Desktop Preview rollout](MCP_CLAUDE_DESKTOP_PREVIEW_ROLLOUT.md).

Companion installer: 59,186,176 bytes; SHA-256
`43cad18e2b5e3b2588b362c1e92e513fa5588aaed5e0b9bf12aec6a8ed0ae4a5`.

Companion manifest SHA-256:
`973518b1458025bb2344cbb98c8322d1f5000199518b8947db303e228c0ce08b`.

Desktop extension: 9,715 bytes; SHA-256
`31b40417c0dd4b4855009467cbfbe1bc1c90d6607e77d45874f2f12b285a70e0`.
Its help/privacy links target the staging deployment, not an unreleased production page.

Generated artifact paths and public hashes are recorded under
`.artifacts/companion/latest-build.json` and `.artifacts/claude-desktop/latest-build.json`.
Neither payload is committed to Git. Both must be published under one approved
`companion-preview-YYYYMMDD-<commit>` prerelease and re-downloaded/hash-verified
before enabling their matching branch-scoped metadata. Do not advertise the old
companion as supporting Desktop's new profile port.

## Remaining gates / rollout

1. Scoped approval to commit/push the feature branch, publish both matched unsigned
   previews, apply **only** `20261013184134_claude_desktop_setup.sql` to the correct
   hosted project, and configure Desktop setup on the MCP branch Preview. Default
   policy stays false until that explicit staging activation. Preserve user data,
   existing grants, production MCP state and paused collector.
2. Verify hosted catalog/ACLs and deployment preflight, anonymous download denial,
   public notice, owner app download and actual downloaded artifact hashes.
3. Owner installs the app-downloaded matched preview, prepares a **new Desktop**
   profile and completes its separate browser approval. Existing CLI profiles
   remain unchanged. Install the downloaded MCPB through Desktop's official UI.
4. Actual Desktop Chat discovery/read/write, resources, restart/renewal and live
   revocation/reconnect acceptance. Configuration, installation and companion
   verification alone must never be reported as this actual-client pass.
5. Then continue the separately scoped Claude remote connector and outstanding
   broader release gates. Gemini/standalone ChatGPT and actual VPS operation remain deferred.

## Review

- Layer 1 — plan alignment: PASS for the approved local implementation; Desktop
  Chat is separate from Code/remote and uses app-downloaded matched artifacts.
- Layer 2 — system integrity: PASS; existing typed services, private owner-bound
  RPCs, protected renewal, audit contracts and theme tokens are reused.
- Layer 3 — production readiness: PENDING, important release gate. Hosted release
  and actual Desktop consent/tool/renewal/revocation acceptance are not yet proved.
  This is not a reason to enable production MCP or report full client completion.

| Before | After | Why |
| --- | --- | --- |
| CLI choices did not distinguish Desktop Chat | Explicit Desktop Chat label and separate connection guidance | Prevents reusing the Code profile or claiming a remote connection |
| No app extension download | Owned download control; missing metadata explains unavailable state | No local folder patches or misleading installation success |
| Existing Card/Button/Select tokens | Same tokens, wrapped download text and keyboard focus; both mobile themes checked | Preserves readable, consistent controls without new visual rules |

## 2026-10-14: fresh-install Desktop startup isolation

The owner's fresh app-downloaded 0.1.1 installation uses the sealed companion
manifest `ea33b4fb34e21fab55b09ae1e1e18fb6859ac930016c69d8c93d2cfdb21fb34d`.
Its selected and imported public Desktop setup match. Actual Desktop 2.37337.1.0
started the correct native launcher, but its startup log showed initialization
without a server response before the client timeout. This was not a successful
Desktop Chat connection.

After the owner disabled only this extension, its previous launcher remained
running. One read-only standalone check returned `PROFILE_BUSY`. The exact
disabled-extension launcher was stopped after verifying its executable, parent,
creation time and disabled setting; the unrelated Codex launcher was preserved.
No installation files, grants, terminal settings or startup tasks were changed.

Sequential read-only probes of the **installed, released 0.1.1** launcher passed:

- `node .artifacts/claude-desktop/verify-fresh-desktop.mjs`: initialized;
  84 tools and 8 resources discovered.
- Same command with `--host-shim`: initialized; 84 tools and 8 resources
  discovered with a workspace-only reproduction of Desktop's rebound streams.

The first shim attempt used an inaccurate input reader and failed; it is not
evidence of a product defect. The corrected shim uses a source independent of
the rebound stdin, matching Desktop's public utility-host implementation.

An unpublished 0.1.2 candidate pauses potentially flowing stdin before validation
and has regression coverage, but that scenario has **not** been demonstrated as
the actual Desktop root cause. Do not publish it as the proven fix.

The owner subsequently re-enabled only Trade OS and confirmed that it appears
under the new Desktop chat's Connectors menu. The fresh startup at
`2026-10-14T05:16:37.210Z` received its first server response at
`05:16:53.304Z`, followed by additional request/response exchanges without a new
timeout in the inspected log. **Actual Desktop initialization and connector
discovery pass on the existing 0.1.1 installation.** This does not establish why
the earlier handshake stalled, nor prove writes, renewal or revocation.

The owner's subsequent Desktop Chat screenshot shows the Trade OS extension's
`tradeos_accounts_list` invocation and a result listing five accounts. **Actual
Desktop read-only account-tool acceptance passes.** The chat reports that nothing
was modified; no write was requested for this check. Account names and financial
values are intentionally not reproduced in this public-repository evidence.
This screenshot establishes successful account retrieval, not an independent
audit of every displayed financial calculation. Resource reads, a controlled
write, restart/renewal and live revocation/reconnect were separate pending gates
at that checkpoint.

The subsequent owner-run controlled write passes: the inactive strategy fixture
`3be263e6-c305-4b88-acdc-07e3d02bd136` was created at version 1, read, archived
with a reason at version 2, and independently read as inactive/archived. No retry
was needed. A narrowly scoped hosted read confirms two receipts/two audits, one
audited client and correct owner/target binding for the two predetermined
operation IDs. **Actual Desktop controlled create/read/archive passes.**

The owner also identified `archived_at > updated_at` on that fixture. Hosted
readback confirms a 0.290734-second gap caused by `clock_timestamp()` in the
archive writer versus transaction-start `now()` in the shared update trigger.
The source fix, local regression gates and approved hosted migration pass.
The deployed private function/ACLs and a rolled-back hosted timestamp probe are
verified; historical receipts/audits were not rewritten. See
[archive timestamp verification](MCP_ARCHIVE_TIMESTAMP_VERIFICATION.md).
Desktop resource reads, restart/renewal and live revocation/reconnect remain
pending; controlled writes must no longer be listed as untested.

## Subsequent requested-restart attempt: failed, not a passed restart gate

The owner reported two Desktop account-tool attempts timing out with the client
message that the PC did not respond within 60 seconds. Inspection at
`2026-10-14T06:45:46Z` showed that Desktop's main process was still the one
started on 13 October and its Trade OS launcher still the one started at
`2026-10-14T05:16:45Z`. The exact MCP log was last modified at `05:46:19Z`;
neither failed tool attempt produced a new adapter request entry. This attempt
did not produce a fresh process/handshake and must not be counted as restart or
credential-renewal acceptance. The client's sleep/lock explanation is unproven.

Independent public discovery and calculator reads returned HTTP 200. An initial
Codex account-list probe returned the sanitized application/network-unavailable
error; a subsequent authenticated kept-account read succeeded. This rules out a
continuing total hosted outage, not all transient network problems. No response
from these probes is substituted for Desktop acceptance.

The next owner action is a full Quit/Exit (not only closing the window), with a
process check before reopening, to distinguish a retained Desktop relay from a
genuine fresh-start defect. No installed files, grants, MT5 settings or running
processes were changed during this inspection. The unpublished startup candidate
remains unproven and must not be advertised as resolving this new timeout.

The owner then performed a full Quit/Exit. The log records transport closure at
`2026-10-14T07:19:47Z`; a subsequent read-only process check finds neither the
identified Desktop application/utility host nor its Desktop-specific native,
Node or vault worker running. **Actual full-exit cleanup passes without forced
termination.** No standalone credential-renewal probe is run before reopening,
so it cannot mask a failure in Desktop's own fresh-start/renewal path. Fresh
launch and account-tool read are still pending owner execution.

## Fresh-start timeout update

The subsequent genuine fresh start failed before its first server response.
Read-only process/log inspection places native adapter creation roughly 65.5
seconds after initialization. A scoped 0.1.2 candidate preserves buffered input,
parallelizes full sealed verification with four bounded checks, adds safe startup
stages and a 45-second first-response deadline, and closes its own utility host
when the child exits. Packaged direct and Desktop-stream-shim preflights now
discover 84 tools/eight resources and read the single preserved account.
The unsigned 0.1.2 release and configured staging app delivery now pass, with
the user's explicit unchanged-companion reuse exception. Actual Desktop restart
and completed owner-browser download acceptance remain pending. See
[startup timeout evidence](MCP_CLAUDE_DESKTOP_STARTUP_TIMEOUT_FIX.md); do not treat
this candidate's SDK success as actual Desktop UI acceptance.

## Primary references

- [Claude Desktop local extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Official MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [Supabase public OAuth and S256 flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)

The MCPB repository moved to the modelcontextprotocol organization; the official
CLI package is still `@anthropic-ai/mcpb` (verified 2.1.2), not
`@modelcontextprotocol/mcpb`. Validation required no project dependency changes.
