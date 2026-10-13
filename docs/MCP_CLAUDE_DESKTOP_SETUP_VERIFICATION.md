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

## Built artifacts, not yet published or installed

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

## Primary references

- [Claude Desktop local extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Official MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)
- [Supabase public OAuth and S256 flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)

The MCPB repository moved to the modelcontextprotocol organization; the official
CLI package is still `@anthropic-ai/mcpb` (verified 2.1.2), not
`@modelcontextprotocol/mcpb`. Validation required no project dependency changes.
