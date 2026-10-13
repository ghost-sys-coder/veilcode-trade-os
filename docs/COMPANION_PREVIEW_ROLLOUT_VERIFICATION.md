# Companion / app-led MCP Preview rollout — 2026-10-13

User explicitly approved the tested hosted migrations and MCP Preview setup, and
changed the repository to public. Production MCP and MT5 setup stay disabled.
This is an unsigned acceptance preview, not completion of the real-client matrix.

## Hosted prerequisites and scope

Installed on Trade OS project `nhwlxcrsivmawwmjiwck`, VeilCode Studio:

| Approved original migration | Hosted/source registry ID |
| --- | --- |
| `20261012145812_integration_setup_profiles.sql` | `20261013023636_integration_setup_profiles.sql` |
| `20261012200515_mt5_companion_pairing.sql` | `20261013023643_mt5_companion_pairing.sql` |

The provider assigned new timestamps. Source files were renamed with SQL unchanged,
and browser-fixture references updated, to avoid replaying already-installed DDL.
No broad migration-history repair or user data changes were made.

Readback: all four new private tables enforce RLS; anon/authenticated direct SELECT
is denied; all three setup/audit guards exist. Three deliberate legacy conflict
codes now use PT409 rather than retryable serialization failures. No setup profiles
or pairings existed immediately after migration. Only the MCP setup policy was
enabled for the exact `https://mcp-preview.veilcode.studio/mcp` resource; MT5 policy
remains false. Only `feature/mcp-access` Preview received setup enablement and the
three public artifact-metadata variables. Existing sensitive Preview secret stayed
server-only and unchanged; no production configuration/promotion or broker action.

Read-only pilot check: local PAUSED, attention null, zero pending pages. The server
connection was already ACTIVE at version 20/fence 6; server eligibility is not local
running intent. Neither mapping, grant, terminal, task nor intent was changed.

Security advisors: intentional INFO notices for deny-by-default private tables with
no direct RLS policy. Existing WARN: leaked-password protection disabled; no auth
configuration or paid upgrade was made. See the
[Supabase remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Installer delivery

GitHub visibility confirmed public. Published only the tested installer, first as
a draft, then an explicitly unsigned prerelease (not Latest), against product
source `fe451bac39fb629f81cc8afda333d8388de7fb51`:

[Acceptance prerelease](https://github.com/ghost-sys-coder/veilcode-trade-os/releases/tag/companion-preview-20261013-fe451ba).

Asset `TradeOS-Companion-Windows-x64.exe`, ID 635667034, 59,171,328 bytes.
SHA-256 `87a633e0fd9e3a688a7865cd507c6e0f473537a7faeac61b03baa417b0f002c0`.
Local checksum, GitHub uploaded digest and complete anonymous streamed download
match. No credentials/configurations/vaults/spools/trades were uploaded. Original
runtime/dependency license notices are included; the MT5 terminal is not bundled.
Checksums verify bytes, not publisher identity; users must not bypass OS security.
The original private-test installer wording/internal UNRELEASED package marker
remains intentional for this experimental acceptance binary, not stable certification.

The initial bounded 120-second download failed verification with redacted details.
HEAD proved the asset reachable via the expected HTTPS GitHub asset host; a bounded
300-second artifact-transfer retry completed and matched. Application and test
timeouts were not increased. No paid storage, infrastructure or AI-provider API used.

## Setup UI and checks

Setup pages now offer the pinned release download only when the owned READY
profile's setup environment is enabled and tag/checksum/size metadata is complete.
No arbitrary host, redirect, submitted owner or secret is accepted. Download,
installation, authorization and observed activity remain distinct milestones.
No metadata/missing policy means explicit unavailable guidance, not a fake link.
Public calculator and all application-data authorization remain unchanged.

| Command / verification | Result |
| --- | --- |
| `npm test -- --maxWorkers=1` | PASS: 1,160 tests / 66 files, including 24 artifact-contract tests |
| `npm run test:db -- --pending-migrations` via established local diagnostic helper | PASS: all 29 rollback-isolated local suites; pending schemas/history and diagnostic hints restored |
| `npm run test:integration-setup` with loopback app and public test metadata | PASS: final 7 provider/browser checks, Chrome 154.0.8037.99; own records cleaned; both-theme 390px screenshots inspected |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next 16.3.8; calculator remains static |
| GitHub metadata + anonymous file digest | PASS: exact size/hash, public prerelease, not stable |
| Hosted schema/ACL/guard/policy readback | PASS |
| `npm run check:application-db` with setup enabled, hosted read-only catalog | PASS: 46 functions and 14 version/order columns |

Native and Python product code was unchanged; the previous 44/189/6 Python and
15+41 native results are retained evidence, not falsely reported newly rerun.
The editor's formatting changes in the setup page were preserved.

Initial browser failure was a selector expecting link instead of Base UI's button
role. Corrected the test against the installed library. Visual review also found
hidden mobile clipping despite page scroll-width passing. Fixed wrapped download
button and dynamic-height status badge, added child-boundary/scroll-height checks,
and waited for hydration before screenshots. No checks/timeouts were weakened.

Review: plan alignment/system integrity PASS for this Preview increment. Production
readiness remains PENDING real installed-user/terminal/startup and actual Codex
writes/retries/concurrency/revocation, Claude Code, Gemini CLI and remote connectors.
UI registry preserves existing warm light/navy dark tokens; no new theme/motion.

## Deployment evidence

Commit `a188e6c4354a2d8bcbb10d00aabc2da9e83d2764` is pushed on
`feature/mcp-access`. Initial deployment `dpl_CmG1LzMZf2Mkxoq9a9rHZWBNEDAg`
was READY and Vercel automatically assigned `mcp-preview.veilcode.studio`.
The manual alias command was not executed because automatic approval review hit
its usage limit; no alternate alias mutation was attempted.

Build-log inspection caught a deployment configuration defect: the branch-specific
setup flag was stored as `true` plus a trailing newline. Strict comparison safely
kept setup disabled, and the initial build checked only 35 database functions.
Corrected only that approved Preview value to exact `true` through the Vercel
environment API and verified its value and branch. All three public installer
metadata values were already exact. The local stdin helper was corrected to avoid
reintroducing the newline. No production variable or application flag parser changed.

Rebuild of the same exact commit: `dpl_GLhifTbR9Fq8ZkWCF9MGQkw1aKcR`,
`https://trade-j68fj1aki-ghostsyscoders-projects.vercel.app`.
Rebuild is READY. Build logs confirm the setup-enabled gate passed all 46 functions
and 14 version/order columns. Vercel automatically reassigned
`mcp-preview.veilcode.studio`; a fresh hostname lookup resolves that exact corrected
deployment and commit. No manual alias mutation was needed. This final evidence
update is local documentation; the product commit above is already pushed.

Anonymous hosted boundaries remain PENDING: the local read-only HTTP helper failed
before receiving responses, web fetch could not access the endpoints, and the
in-app browser reported `ERR_BLOCKED_BY_CLIENT`. These are access/tool failures,
not passing endpoint assertions or proof of an application defect. No deployment
protection, network isolation or authentication was bypassed.

Production MCP stays disabled. Next is user-led onboarding through the staging setup
screen, not another rebuild of the collector or capability catalog.

## Hosted user observation

The user confirmed that the saved staging setup page shows "Download Windows
Companion" after following the app-led setup path. They explicitly confirmed that
they had not installed the companion or changed MT5. This is evidence of the hosted
download control being visible, not proof of a completed download, installation,
grant, client connection or anonymous endpoint boundary.

Next acceptance step: download the public configuration and pinned installer;
verify the downloaded installer digest before user installation. Do not send
credentials or bypass Windows security warnings. Preserve the MT5 pilot and tasks.

## Downloaded user files verified

User supplied `D:\TRADE-OS-INSTALLATIONS`. Read-only inspection found the expected
installer and `tradeos-codex-2638fa90-01f6-4450-b3ae-a88eefe51304.json`.
`Get-FileHash -Algorithm SHA256` matched the published installer digest above;
size is exactly 59,171,328 bytes. Authenticode reports `NotSigned`, as documented.
The existing Python `bootstrap(load_public_file(...))` validator passed with
bytecode writes disabled: MCP / CODEX, exact staging resource and Supabase issuer,
registered loopback callback 9878, profile `2638fa90-01f6-4450-b3ae-a88eefe51304`.
This validation performs no import, local profile write, grant or network request.
Real installation, browser consent and application-access verification remain
pending user interaction with the native companion.
