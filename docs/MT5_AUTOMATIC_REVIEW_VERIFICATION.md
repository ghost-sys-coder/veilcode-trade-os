# MT5 automatic publication, conflict review and Windows recovery

Date: 2026-10-07. Branch: `feature/mt5-sync`.

## Approval-prerequisite usability correction — 2026-10-08

The user reported that entering a publication-policy reason left Enable automatic
publication disabled. Hosted readback confirms the latest stored approval matches
the ledger/checkpoint but predates the expanded source fingerprint, so it is stale.
There are zero source holds/incomplete collections; the ledger remains twenty
trades and USD +2032.53. The required fresh snapshot approval was buried at the
bottom of the history page, while the dependent reason field accepted input.

Move snapshot approval immediately above automatic publication, add an explicit
prerequisite explanation and same-page link, and disable the dependent reason
input until approval completes. Preserve the database requirement for explicit
current-snapshot approval. Browser verification exercises the locked controls,
link, snapshot approval and subsequent policy enablement.

Verification: `npm test` passes 485 tests / 38 files; `npm run typecheck`,
`npm run lint` and `npm run build` pass. `npm run test:integration-browser`
passes all 53 actual local browser/provider/API checks, including the new
prerequisite navigation and subsequent approval/policy enablement. Both themes
and the narrow viewport render without horizontal overflow. No SQL, money,
collector or authentication behavior changed in this usability correction.

Fix commit `9c9f7bb` is pushed. Vercel deployment
`dpl_CAhRvE7d1U94mCRr8BmRcrR7QLeP` built successfully, passed the public-calculator
HTTP 200 check, and was promoted to `tradeos.veilcode.studio`; production-domain
inspection confirms that READY deployment. The user's fresh snapshot approval
and account-policy activation remain explicit browser actions.
Status: implemented, locally verified, pushed as `690c3f7`, and deployed.
The user activated the account policy and the final bounded USD100K DEMO capture
passed on 2026-10-08 (Africa/Kampala). The three requested final capabilities are
verified within the single-demo rollout; broader operational limitations below
remain explicit. MCP may proceed from the merged shared foundation.

## Final real-demo readback — 2026-10-08

The user approved the refreshed snapshot at 2026-10-07T21:16:16.983449Z and enabled
the account-specific automatic baseline of USD 100000 (connection version 20).
Temporarily disabled/stopped only the verified dedicated scheduler task, ran the
bounded coordinator helper, then restored the enabled task in finally. The helper
always returns local collection intent to PAUSED.

Actual read-only capture advanced local/server checkpoints to
`2026-10-07T21:20:56.220Z` and durable hosted sync to
`2026-10-07T21:21:02.304376Z`. With the automatic policy enabled, repeated unchanged
executions preserved 20 unique canonical trades and 20 execution versions;
normalized net PnL remains USD 2032.53. Baseline stays USD 100000, adjustments zero,
source review holds zero and incomplete collections zero. Spool integrity is ok,
pending pages zero, attention absent and collector intent PAUSED. The restored
scheduled coordinator is running idle under new worker identity
`39fa5b34-f85d-4410-97ba-dcdbbc47cace`; the collection lease used fence 6.

This actual pilot proves the authenticated capture/publication path safely handles
unchanged broker history. Changed/closed trade automatic publication and explicit
conflict review were exercised by deterministic database fixtures and the real
local browser/API suite; no broker orders were created to manufacture a change.
Fresh captures can stale snapshot reconciliation while retaining the separately
approved publication policy. No sign-in/reboot/extra-terminal test is claimed.

## Delivered behavior

- Explicit, audited, account-specific automatic-publication policy, initially off.
  Enabling requires approval of the current onboarding snapshot and preserves its
  positive opening baseline. Revocation, pause, stale fencing or changed baseline
  prevents automatic publication.
- Signature-verified collector capture and eligible canonical publication share
  one private PostgreSQL transaction. Complete collections only; durable receipts,
  replay protection, central decimal calculations and the existing execution writer.
- Changed broker facts remain held until explicit source review. Raw revision
  chains and the review decision are immutable.
- Manual overlaps can be reviewed as distinct, withdrawn for review again, or
  linked to the existing manual trade. Linking preserves the trade ID, original
  plans, thesis and reviews, and records the previous manual record.
- Revised classified cash requires explicit source review and classification of
  only the monetary delta. Original cash evidence and adjustments are retained.
- Windows startup includes sign-in, restart-on-failure and a one-minute recovery
  trigger, with IgnoreNew and the account-specific native single-instance lock.
  Repair refuses to overwrite a task with a different principal or command.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | 485 tests, 38 files passed |
| `npm run test:db` | Stock local image crashes on a denied EXECUTE; unchanged runner passes all 501 assertions / 13 suites with the temporary local diagnostic-hint workaround below |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, Next.js 16.3.6, 30 generated pages |
| `npm run test:mt5-python` | 176 passed, Python 3.13.2 |
| `npm run check:mt5-python` | Passed |
| `npm run test:integration-browser` | 52 browser/provider/API checks passed, Chrome 154.0.8037.93 |
| `supabase db advisors --local --type security --level warn` | No issues found |
| `supabase db pull mt5_release_check --local --yes --schema public,private` | Shadow replay completed; no schema changes found (CLI returned exit 1 for the empty diff) |

The local database regression crashes at the existing signing-hook permission
test, including a direct call outside pgTAP and with JIT disabled. This matches
[Supabase postgres #2112](https://github.com/supabase/postgres/issues/2112) and
[supautils #214](https://github.com/supabase/supautils/issues/214). The local image
reports PostgreSQL 17.6 and `supautils.hint_roles=anon, authenticated, service_role`.
Using the container's existing administrative credential, temporarily set this
diagnostic-hint setting to the empty string with ALTER SYSTEM and reload. Run
`scripts/run-db-tests.mjs`, then RESET the setting and reload in a finally block.
The full unchanged suite passes; the original setting is restored. No privileges,
RLS, constraints, assertions or hosted settings were changed. The ignored local
helper is `.artifacts/mt5-pilot/local_database_hints.mjs --test`.

Fixture calculations verified through the database/browser:

- Final execution: gross 100 - costs 3 + credit 1 = 98.
- Automatic final result 25 publishes once; replay produces no duplicate or extra
  revision. Broker correction 25 to 30 is held, reviewed, then updates the same trade.
- A linked manual execution remains at version 1 on an unchanged subsequent capture.
- Deposit revision 250 to 255 creates only +5 cash adjustment; the prior deposit
  survives. The fixture's reconciled balance is 1336.87 with zero bridge difference.

## Actual Windows evidence

Installed and verified only task
`TradeOS-MT5-070d71f7-4bb1-49a5-ae6b-2659ee6240c2`, using the dedicated pilot
manifest, current-user InteractiveToken, LeastPrivilege and pythonw. The original
restart-on-failure setting did not recover a forcibly terminated coordinator.
The added periodic trigger did: the read-only outbox changed worker identity from
`cb9e6e32-aa06-40b7-b7a5-b3ff987bb0a3` to
`d5e72e67-59bd-49b9-8652-b2127a808f12` after controlled coordinator termination.
The collector remained PAUSED, with no attention, zero pending pages and checkpoint
`2026-10-07T14:51:30.826Z`. The task remains installed and enabled; PAUSED intent is
durable. A repeated trigger ignored while already running may report 0x800710e0.

No Windows logout/reboot, locked-session or VPS/RDP test is claimed. Before-login
startup is not supplied by an InteractiveToken task. Extended soak was deferred
by the user. Real multi-account terminal checks remain outside this single-account
pilot; automated account isolation/fencing tests pass.

## Review and rollout gates

Plan alignment: the three requested capabilities are implemented. Broader roadmap
limitations remain explicit: local pending-upload telemetry is not yet sent to
the monitoring page; actual sign-in/reboot and additional real terminals are pending.

System integrity: verified actors, private transactional mutation services,
append-only reviews, account-bound grants and central financial calculations are
preserved. UI uses the existing themed review forms and alert patterns.

Production readiness: local checks pass with the documented database-image
workaround. The migration was applied to `nhwlxcrsivmawwmjiwck` under the correct
VeilCode Studio connection. Before/after readback preserves 20 trades and USD
2032.53 net PnL; automatic publication defaults off.

Vercel deployment `dpl_6EqoaL8xJDcQpCNWUApY3pE97w4m` built successfully and was
promoted to `tradeos.veilcode.studio` after staged discovery, public-calculator
HTTP 200 and anonymous integration-session HTTP 401 checks. Production-domain
inspection resolves to that READY deployment. The CLI's Node runtime is 24.x.

Hosted security advisors reported informational no-policy notices for the 19
private integration tables: this is intentional deny-by-default access through
the checked private workflows. The existing Auth warning is leaked-password
protection disabled; no Auth configuration was changed in this release. See
[Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The browser-control service failed with “Unable to load browser request-header
policy” on repeated inventory attempts and after a session reset. The user was
given the exact existing-account page to approve its current snapshot and enable
the policy through the normal authenticated form. Do not bypass browser consent
with administrative SQL. Read-only SQLite verification still shows PAUSED,
no attention, zero pending pages and the preserved checkpoint.

After policy activation, run a bounded capture with hosted ledger readback before
reporting real automatic publication verified. Return collector intent to PAUSED
after that test. No broker execution is included.
