# MT5 protected credentials and supervision checkpoint

Date: 2026-10-05. Branch: `feature/mt5-sync`; starting commit `5f99d64`.
This is an incremental verification report, not MT5 completion or release approval.
`master` and parked `feature/mcp-access` were not changed. No real MT5 installation
was attached, no broker execution occurred, and no hosted schema/data was changed.
This report accompanies the credentials/supervision checkpoint. Git history and
the handoff record identify its commit/push status; it is not a release approval.

## Implemented scope

- Public-client S256/state/loopback callback validation and resource-bound OAuth.
- Live owner/account/client/grant verification before credential acceptance.
- Renewable user-scoped Windows DPAPI vault, protected ACLs, bounded strict JSON,
  atomic encrypted replacement, and no plaintext credential fallback.
- Fixed-module capture/upload subprocesses with bounded input/output, discarded
  stderr, process deadlines, Ctrl+C cleanup and exact owned-PID termination.
- Native Windows job containment: supervisor death stops the owned Python worker;
  spawned children break away so this guard does not kill a terminal.
- Account-scoped polling/heartbeat/retry/daily-reconciliation coordinator and
  interruptible loop, with durable default pause and restart-persistent attention.
- Local SQLite version 3 upgrade preserving frozen collections, pending exact
  operations, old lease claims and capture/server checkpoints. Append-only local
  control/generation evidence; atomic mode/evidence updates.
- A fresh collector ID per coordinator lifetime. Copied spools cannot make a
  replacement VPS appear to be the old laptop worker. Pending envelopes stay intact;
  existing higher-fence operation lookup remains the authority for recovery.

Authentication uses no AI-provider credentials, broker passwords or paid APIs.
No monetary calculation or canonical trade publication was added in this increment.
The existing financial/reconstruction fixtures remain in the application test suite.

## Exact verification

| Command | Observed result |
| --- | --- |
| `npm run check:mt5-python` | PASS: Ruff and compileall |
| `npm run test:mt5-python` | PASS: 146 tests, including native Windows calls |
| `npm test` | PASS: 282 tests in 21 files |
| `npm run test:db` | PASS: 228 assertions in five rollback-isolated suites |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next 16.3.6 production build; 30 generated pages |
| `npm run test:integration-browser` | PASS: 33 actual local provider/browser/API/Python checks, rerun after the final native containment/loop additions |
| `supabase db lint --local --schema public,private --level error --fail-on error` | PASS |
| `supabase db advisors --local --type security --level warn --fail-on error` | PASS: no issues |
| `git diff --check` | PASS for tracked changes at inspection |

Versions observed: Python 3.13.2, Node 25.1.0, Supabase CLI 2.95.4, Next 16.3.6.
The browser suite uses installed Chrome with an isolated headless profile; the
previously recorded Chrome version is 154.0.8037.93. No actual broker/client matrix
or Windows Server/RDP environment is represented by these fixtures.

The initial sandboxed browser rerun failed because Docker configuration/pipe access
was denied. Elevated inspection confirmed the existing local containers healthy
and the app listening on 127.0.0.1:3100; the same suite then passed. No Docker restart
or data reset was performed. An earlier final rerun was blocked by an automatic
approval-service usage limit. After approval access returned, the final rerun after
native job containment completed with all 33 checks passing. No approval bypass or
hosted credential substitution was used.

Non-failing diagnostics: Node's existing MODULE_TYPELESS_PACKAGE_JSON warning;
Supabase CLI telemetry timeout. No application module-type change was made solely
to suppress test-runner warnings. Browser coverage recorded zero uncaught page errors.

## What the checks actually prove

Native tests exercise current-user DPAPI encryption/decryption and scope/tamper
rejection, protected ACL contents, same-user process restart, process-death lock
release and injected encrypted-write/encryption failures preserving old records.
They do not prove cross-Windows-user, locked-session or reboot behavior.

Actual subprocess tests cover stalls, Ctrl+C cleanup, crashes, malformed/non-finite
or duplicate-key JSON, output overflow, containment failure and termination after
a committed frozen collection. The reopened SQLite database passes integrity checks
and retains its pending page/capture cursor. A controlled supervisor is forcibly
killed; its guarded Python worker exits while its Python terminal stand-in remains
alive. Both are test-owned processes, not an installed broker terminal.

Coordinator fixtures cover 15-second polling, 30-second idle heartbeat, 120-second
stale boundary, daily reconciliation across restart, upload backpressure, jittered
retry recovery, short-lease rejection, sleep/wake, clock rollback, persistent
pause/attention, account isolation, copied-spool fresh identity, immutable local
evidence and transactional rollback on an injected state-update failure. Broker/API
adapters are injected in these scheduling tests; they are not a real-terminal soak.

The real local browser suite independently completes Supabase consent and PKCE,
checks signed resource claims, grant isolation, refresh rotation, revocation, login,
logout and anonymous calculator access. The default-vault fixture privately changes
LOCALAPPDATA only in its test process/children, then runs two actual supervised upload
workers. Source ticket 40 produces exactly one server revision; the second process
reloads credentials/outbox without another effect. Existing ticket 20 lost-ACK and
  ticket 30 fenced-UNKNOWN tests also remain single-effect. Source captures are staged,
not silently published as canonical trades.

Fixture cleanup inspection: zero users, trades, active OAuth clients, grants/grant
events, connections, source facts/revisions, capture collections/batches, operations
or mutation audits. Nine deleted local OAuth-client tombstones remain from provider
soft deletion; they are not active clients and were not hard-deleted. Exact UUID
credential/spool files are cleaned without recursive broad-directory deletion.

## Review and release limitations

Plan alignment: this increment implements credentials/supervision/scheduling;
MT5-1 through MT5-5 remain incomplete. MCP stays parked as approved.

System integrity: financial authority remains central TypeScript/PostgreSQL. OAuth
tokens cannot directly read workspace tables. Local SQLite is recovery/control
storage, not an alternate authorization or canonical-trade model. Existing outbox
operations and audit evidence are not rewritten when a new worker starts.

Production readiness: not approved. Outstanding requirements include:

1. Commit and push the verified checkpoint (latest provider/browser/worker rerun passed).
2. Operational consent callback listener, install/run/control commands and Windows
   Task Scheduler sign-in/restart configuration. No startup task has been installed.
3. Cross-user, locked-session, reboot-before-login, terminal restart and future RDP
   checks. Process creation itself cannot be interrupted by Python's wait deadline;
   outer job restrictions and actual terminal breakaway behavior need verification.
4. Shared canonical workflows, trading-credit persistence and episode identity
   migrations, transactional publication, historical onboarding/reconciliation UI.
5. Complete controlled multi-account demo pilot and focused interruption checks.
   The user deferred the mandatory 48-hour soak on 2026-10-05; it was not performed
   and must not be described as passed.
6. Hosted configuration/release gate, then MCP service coverage, protocol and
   requested real-client verification on its own updated branch.

Lost refresh acknowledgement is deliberately attention-required: persist uncertainty
before requesting refresh; save usable credentials only after receiving and verifying
the replacement. If the outcome is uncertain, reconnect through fresh consent.
No OAuth-server reuse/idempotency guarantee is assumed from Supabase browser sessions.

Review fixes applied: MT5-containing attention codes accept digits; backward UTC
movement preserves the cursor and requests clock repair; terminal config is copied
against caller mutation; collector IDs rotate per process; abrupt supervisor death
cannot leave an uncontained native worker behind. Missing operational gates are
reported above, not marked passed. The full MT5/MCP goal remains active.

## Primary references

- [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Microsoft user-scoped DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
- [Microsoft protected ACLs](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow)
- [Microsoft job limits and breakaway](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- [Microsoft job assignment](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- [Python subprocess deadlines](https://docs.python.org/3.13/library/subprocess.html)
