# MT5 hosted pilot foundation rollout

Date: 2026-10-05–06 (Africa/Kampala). Branch: `feature/mt5-sync`.
Source checkpoint: `7566ca1`, plus deployment exclusion/configuration documentation.
User approved the hosted migrations and supplied `https://tradeos.veilcode.studio`.
This is a disabled-integration pilot foundation, **not full MT5 readiness or merge approval**.

## Delivered

- Applied the eleven missing integration migrations to the existing Trade OS
  project through the approved Supabase connection, in source order. Existing
  baseline migration history was preserved. The nineteen baseline migrations
  have matching names but some different deployed timestamps; do not blindly
  run `supabase db push --include-all` against this project.
- Saved a private, ignored before-rollout ledger backup. After removing only
  newly added MT5/default-credit columns from the comparison, all existing account,
  trade and adjustment rows are structurally identical before and after rollout:
  five accounts, one trade, zero adjustments. No financial history was rewritten.
- Registered the exact MT5 resource with `enabled=false`. There are zero
  integration grants and zero MT5 connections. No captures, imports, startup
  tasks, broker orders or automatic publication were initiated.
- Set the approved site/integration origin in local and production configuration.
  Production MT5 and MCP flags are explicitly false. Secrets were not changed.
- Added `.vercelignore` to exclude local terminals, fixtures, credentials, backups,
  environment files and other private/runtime artifacts from deployment uploads.
  Added disabled integration configuration to `.env.example`.
- Built a production candidate with `--skip-domain`, verified it, then promoted
  it to the approved domain. Git `master` and the parked MCP branch were not merged
  or changed by this rollout.

## Deployment

| Field | Result |
| --- | --- |
| URL | https://tradeos.veilcode.studio |
| Target | Production; both integration flags disabled |
| Status | READY, promoted |
| Deployment | `dpl_AJb733ESsNZUjzz6Ci17gofdLJ1k` |
| Candidate | https://trade-g5nuz9122-ghostsyscoders-projects.vercel.app |
| Previous production / rollback candidate | `dpl_CGPiJpmBvjDgxKyhriLHVVb5a77k` |
| Framework / runtime | Next.js 16.3.6; Vercel Node 24.x |
| Remote build | Approximately 16 seconds; deployment approximately one minute |

The unpromoted candidate is protected by Vercel and initially redirected anonymous
requests. This was not an application auth-wall regression. The official Vercel CLI
generated a project deployment-protection test token for authenticated staging
checks; its value was not printed or committed. Production verification below used
ordinary anonymous HTTP requests without that token. No protection setting was
disabled. Review the CLI-created test credential under Vercel's project protection
settings as part of operational cleanup; do not revoke unrelated credentials.

## Verification

| Exact command / check | Result |
| --- | --- |
| `npm test` | PASS: 383 tests, 31 files |
| `npm run test:db` | PASS: 441 assertions, ten rollback-isolated local suites; no hosted fixtures |
| `npm run check:mt5-python` | PASS |
| `npm run test:mt5-python` | PASS: 167 tests, 27.784 seconds |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS: thirty generated routes/pages |
| `npm run test:integration-browser` | PASS: 43 real local browser/provider/API checks; Chrome 154.0.8037.93 |
| Supabase `apply_migration` for eleven source migrations | PASS; recorded by name below |
| Hosted ledger backup/comparison | PASS: existing ledger unchanged |
| Hosted integration RLS / exposed definers | PASS: zero new integration tables without RLS; zero public integration security-definer functions |
| `node .artifacts/mt5-pilot/verify_private_schema.mjs` | PASS: anonymous private-profile request rejected with HTTP 406 / PGRST106; private schema is not exposed |
| `npm run check:integration-auth` | Eleven hosted metadata capability checks PASSED; six live-flow checks PENDING, `readyForPersistence=false`; script's intentional pending exit 2 becomes npm exit 1, not a full auth-gate pass |
| `vercel env ls production --non-interactive` | Verified linked project; only variable names/encrypted status printed |
| `vercel deploy --prod --skip-domain --yes --non-interactive --meta tradeOsRollout=mt5-disabled-pilot` | READY |
| `vercel inspect https://tradeos.veilcode.studio --non-interactive` before promotion | Verified target project and previous deployment |
| `vercel promote https://trade-g5nuz9122-ghostsyscoders-projects.vercel.app --yes --non-interactive` | PASS |
| `node .artifacts/mt5-pilot/verify_rollout_http.mjs https://tradeos.veilcode.studio` | PASS: seven anonymous production checks |
| `vercel logs dpl_AJb733ESsNZUjzz6Ci17gofdLJ1k --no-follow --no-branch --level error --since 1h --limit 100 --json --non-interactive` | Zero returned error records; this is a bounded scan, not continuous monitoring |
| `git diff --check` | PASS; nonfatal Windows line-ending warning |

Production anonymous checks: calculator 200 without an authentication redirect;
login and consent entry pages 200; private integrations settings 307 to login;
public discovery 200 with the exact approved resource and Supabase issuer;
session API and unauthenticated capture POST 401. These are not completed hosted
owner-consent, PKCE, refresh or revocation tests.

Applied migration names, in order:

1. `integration_oauth_isolation`
2. `integration_grants`
3. `integration_consent_context`
4. `mt5_durable_capture`
5. `mt5_collection_checkpoints`
6. `mt5_canonical_finance`
7. `mt5_onboarding_monitoring`
8. `mt5_canonical_publication`
9. `mt5_execution_money_precision`
10. `mt5_symbol_mapping`
11. `mt5_cash_onboarding`

## Security observations and operational blockers

The hosted security advisor reported eighteen informational RLS-without-policy
notices for deliberately private, direct-access-denied integration tables. Do not
add permissive policies merely to silence these notices. It also reported the
unchanged [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No paid service or unrelated authentication setting was activated.

A request to download production environment values was rejected by the safety
reviewer. No production environment file was retrieved and no workaround was used.
Deployment proceeded using existing CLI authorization and name-only environment
inspection. The configured database credential already in local `.env` was used
only for a sanitized, read-only strict-TLS connectivity probe.

That probe returned `ENOTFOUND` for the IPv6-only direct database endpoint. Public
DNS confirms an AAAA record and no A record. An approved session-pooler hostname
and port are needed to validate this workstation's connection and the private
publication path. Do not disable TLS verification or purchase an IPv4 add-on as
a workaround. The current account baseline remains unchanged and unreconciled.

The user must complete these dashboard prerequisites (no passwords/keys in chat):

1. Set Supabase Site URL to the approved HTTPS app origin; preserve the consent
   path `/oauth/consent`.
2. Enable the custom token hook `private.integration_access_token_hook`.
3. Register the public client `Trade OS MT5 Desktop Pilot`, token endpoint method
   `none`, exact callback `http://127.0.0.1:9876/callback`; keep dynamic registration
   disabled. Provide only the client ID.
4. Provide the Connect → Session pooler hostname and port, not its password.

After those prerequisites: verify strict TLS, configure the controlled authorization
resource/flag without starting collection, perform real browser consent/PKCE/refresh/
resource/revocation/login checks, map the verified dedicated demo terminal, initialize
a PAUSED operational manifest/outbox, capture the approved history, reconcile and
explicitly approve the baseline/snapshot, then run focused recovery/isolation tests.

Dedicated terminal identity has passed read-only native verification (USD, precision
two, DEMO, HEDGING); broker execution/history collection has not occurred. Private
pilot identifiers and observed financial values remain in ignored preparation
artifacts. Current server spelling is the exact broker-reported form; comparisons
were not weakened. Full source/manual conflict handling, unattended canonical
updates, Windows startup/interruption checks and MCP implementation/client checks
remain pending. The extended soak was deferred, not passed. Drains and long-term
monitoring have not been verified. No full-release or merge gate is claimed.
