# Claude Desktop Chat staging rollout

2026-10-13. Authorized by the user's continuation of the explicitly scoped
staging-release request. Implementation `1358cca33a613b7d51bd619e9653d981103c6217`
is pushed to `feature/mcp-access`; no master merge or production promotion.
Local evidence: [Desktop setup verification](MCP_CLAUDE_DESKTOP_SETUP_VERIFICATION.md).

## Published app downloads

Unsigned prerelease, not Latest/stable:
[companion-preview-20261013-1358cca](https://github.com/ghost-sys-coder/veilcode-trade-os/releases/tag/companion-preview-20261013-1358cca).

| Fixed app filename | Bytes | SHA-256 |
| --- | ---: | --- |
| `TradeOS-Companion-Windows-x64.exe` | 59,186,176 | `43cad18e2b5e3b2588b362c1e92e513fa5588aaed5e0b9bf12aec6a8ed0ae4a5` |
| `TradeOS-Claude-Desktop-Windows.mcpb` | 9,715 | `31b40417c0dd4b4855009467cbfbe1bc1c90d6607e77d45874f2f12b285a70e0` |

Both files were re-downloaded into a new repository artifact folder and both
sizes/hashes matched. Official MCPB 2.1.2 validation accepts the final manifest
and archive, explicitly unsigned. Help/privacy links target staging. GitHub's
`path#label` syntax sets a label, not the asset filename; the companion filename
was corrected through the exact asset metadata endpoint before download checks.
No binary was changed or installed user folder patched.

## Hosted prerequisite and preservation

Correct Supabase account: VeilCode Studio@Zooloop.tv@gmail.com; project
`nhwlxcrsivmawwmjiwck`. Only the tested Desktop migration was applied. Its
provider-assigned ID is `20261013184134`; source filename/fixture reference
were aligned without changing SQL behavior.

Readback verifies v2 RPCs, anonymous EXECUTE denial, authenticated browser
EXECUTE, private-table RLS and initially default-off policies. After matched
downloads and the configured build passed, only MCP's Desktop setup policy was
enabled against the existing staging resource. MT5 setup remains disabled.
Existing counts are three setup profiles and four grants. Before/after fingerprints
remain unchanged, including after policy activation:

| Records | Fingerprint |
| --- | --- |
| Grants | `bfc10607a4be889c6f4f12e6828cd3ba` |
| Setup profiles | `32e1d8a8b1caf00c0c582b990f076dcb` |
| MT5 connection | `2dcd4d26d09e6519dcd821254dc1fc70` |

No accounts/trades, grant permissions, terminal installations, tasks or collector
intent changed. No order execution, model/API call or paid provisioning occurred.
Advisors report INFO for existing deny-by-default private tables with RLS and
no direct-access policies; checked private RPCs remain authoritative. The existing
[leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains unchanged; no Auth/billing setting was silently enabled.

## Vercel release

Project `prj_J06NUbnHQj38DhAK4YX5poGV5ytz`, team `team_24dtIFqfL1X7RkcGc6gVif0X`.
Seven public config/release values were upserted only for Preview, branch
`feature/mcp-access`: companion tag/hash/bytes, Desktop tag/hash/bytes and
`TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED=true`. No secret provisioning/origin changed.

Configured deployment `dpl_9KxXQaPevM3zTN9VLJqVueXqyNur` is READY at reviewed
commit `1358cca`, REST target `staging` (Preview). Its `build:verified` logs pass
48 functions and 14 version/order columns, also verified independently against
hosted catalog data. Build completed in about one minute. The existing staging
alias was explicitly assigned to this configured build because its initial Git
build preceded the env update. The API rejected the literal `preview` target;
the corrected `staging` request did not deploy to production.

Stable URL: [MCP staging setup](https://mcp-preview.veilcode.studio/settings/integrations/connect/mcp).
Production retains `dpl_9QPNPKeKvWQ6WF2RB8n4Utipq3x8`, master `578515f`;
`TRADE_OS_MCP_ENABLED=false` was separately read back. Production was not
promoted/redeployed/enabled or assigned a new domain.

## Hosted read-only smoke checks

Eight GET checks with no user cookies/writes pass:

| Check | Status |
| --- | ---: |
| Staging public data-handling notice | 200 |
| Staging anonymous calculator | 200 |
| Anonymous private setup page | 307 to login |
| Anonymous extension download | 403 |
| Anonymous configuration download | 403 |
| Anonymous staging MCP | 401 with OAuth challenge |
| Anonymous production MCP | 401 |
| Public staging protected-resource discovery | 200 |

Disabled integrations intentionally return authorization denial (401), not
unavailable (503). An initial smoke expectation was corrected against the
existing actor/error implementation; no authentication behavior changed. Status
alone is not evidence of enablement; production's false flag and unchanged
deployment were independently verified.

## Owner acceptance still required

1. Choose Claude Desktop (Chat) in staging and prepare a new setup. Download
   the Desktop JSON, matched companion and MCPB from that setup page.
2. Install the companion in a new version folder, open TradeOS.exe, import the
   new Desktop JSON and approve/verify separate browser access. Do not reuse or
   revoke Codex/Claude Code/MT5, delete old folders or remap trading accounts.
3. In Claude Desktop Chat use Settings → Extensions → Advanced settings → Install
   Extension. Select the MCPB, then the matched companion folder and Desktop
   JSON. No provider API key, developer terminal or hand-edited configuration.
4. Verify actual Chat tools/resources/read/write, restart/renewal and live
   revocation/reconnect. Installation or a companion verification badge alone
   is not this gate. Remote Claude is the next separate increment; Gemini,
   standalone ChatGPT and actual VPS operation remain deferred.

The app-delivered staging build is ready for owner setup, not a claim that every
requested real client or the complete MCP feature has passed.
