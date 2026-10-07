# MT5 HTTPS failover and bounded pilot verification

Date: 2026-10-07. Branch: `feature/mt5-sync`, fast-forwarded to the user's
consolidated `master` at `c9d2a35`. This is an incremental checkpoint, not MT5
release completion or permission to start MCP implementation.

## Captured-history approval and operating boundary

The signed-in normal browser workflow approved the reviewed USD100K DEMO captured
source/ledger snapshot at 2026-10-07T11:32:08.577787+00:00. Its preserved baseline
was USD 100000.00, canonical ledger/observed captured balance USD 102032.53,
unexplained difference zero, and all twenty closed trades were already published.
No original plans, risk or behavioral reviews were fabricated.

The user separately approved a bounded staging/restart test for dedicated demo
login 477190850, returning the collector to PAUSED afterward. No orders,
automatic canonical publication, additional accounts or startup installation were
authorized by that approval. The approval safeguard initially rejected the test
under the earlier PAUSED-only scope; the test ran only after explicit approval.

## Actual failure evidence

The pre-fix coordinator durably captured and uploaded multiple overlapping
snapshots, but later uploads returned INTEGRATION_UNAVAILABLE or WORKER_STALLED.
The initial bounded test exited 1, not a pass. A separate process restart also
exited 1 without fully recovering the backlog. Both returned intent to PAUSED
and preserved one pending page and its original operation evidence:

- Captured checkpoint: 2026-10-07T11:45:56.356Z.
- Server-confirmed checkpoint: 2026-10-07T11:44:11.428Z.
- No pending data was deleted, acknowledged speculatively or manually rewritten.

An independent hosted readback during the test confirmed account start date
21 September 2026, starting balance USD 100000, twenty canonical trades, net PnL
USD 2032.53, zero adjustments and eighty-six source-fact identities. Re-observation
did not multiply those identities. New checkpoints intentionally invalidated the
old onboarding approval; the actual reloaded browser showed STALE_APPROVAL rather
than falsely calling the new snapshot reconciled.

A credential-free per-address diagnostic used hostname-verified TLS. One Trade OS
address returned HTTP 200 in 0.87 seconds; another timed out at TCP after four
seconds. Both tested Supabase addresses also timed out at TCP in that observation.
This establishes uneven desktop reachability, not a proven provider outage or
complete attribution of every worker timeout. Native DNS/TCP/TLS requests and
provider exchanges remain subject to external connectivity.

## Targeted transport change

`https_transport.py` preserves CPython 3.13's normal DNS/address iteration, with a
three-second cap per TCP connection attempt (or the caller's shorter timeout).
It restores the original timeout before native TLS negotiation and HTTP reads.
The original hostname still supplies TLS SNI and certificate verification.
The per-instance dial hook is restored on both success and failure.

The same strict HTTPS handler is used by application requests and the OAuth
client's existing transport. It does not pin IPs, alter system DNS/proxies,
disable certificate checks, redirect credentials, or replay an HTTP request.
Durable operation IDs, account binding, leases, fencing and the 45-second worker
supervisor are unchanged. DNS lookup itself is not claimed to have a new deadline.

Six added tests cover unreachable-address fallback, restored TLS/read timeout,
original-hostname SNI, shorter caller budgets, failed-address socket cleanup,
certificate failure without redial/weaker trust, timeout-restore cleanup and
single-dispatch handler wiring. Existing redirect/proxy/auth tests remain intact.

## Commands and results

| Command | Observed result |
| --- | --- |
| `npm test` | PASS: 470 tests, 35 files |
| `npm run test:db` | PASS: 449 assertions in eleven disposable rollback-isolated suites |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next.js 16.3.6 production build |
| `npm run test:mt5-python` | PASS after transport change: 173 tests |
| `npm run check:mt5-python` | PASS after transport change: Ruff and compileall |
| `npm run test:integration-browser` | PASS after transport change: 47 checks, Chrome 154.0.8037.93 |
| `git diff --check` | PASS |
| `diagnose_auth_public.py` | PASS after transport change: both public HTTPS endpoints HTTP 200; protected state REAUTH_REQUIRED |

The TypeScript/database/build commands ran on the consolidated application before
the Python-only transport edit; no application schema or TypeScript was changed
by that edit. The first unprivileged database command could not access Docker;
the properly authorized rerun used the healthy disposable local stack. An attempted
second test-app startup found port 3100 already occupied; verified local resource
metadata pointed exclusively to loopback Supabase before reusing that app. Neither
failure was counted as a passing command or a reason to test hosted data.

The post-fix live recovery attempt stopped before collection because an expired
session's refresh could not be confirmed: OAUTH_REAUTHORIZATION_REQUIRED.
The vault remained REAUTH_REQUIRED rather than replaying a possibly consumed
refresh token. One fresh same-grant PKCE exchange also returned
OAUTH_REQUEST_UNCERTAIN. A later public health check returned HTTP 200 for both
endpoints; fresh reconnection remains a separate gate, not inferred from discovery.
The local browser suite briefly owned callback port 9876, so a concurrent operator
attempt correctly rejected before credential changes. Future operator reconnects
must run after the fixture listener has closed, never by stealing its port.

After that fixture listener closed, another fresh same-grant attempt opened the
normal browser but its code exchange again ended OAUTH_REQUEST_UNCERTAIN. The
operator listener closed and credentials remained REAUTH_REQUIRED; those callback
tabs cannot be reused. Do not repeat uncertain code/refresh exchanges. Before a
further consent attempt, use credential-safe endpoint/status/exception-phase
diagnostics (never request bodies, tokens or provider response bodies) to isolate
the remaining exchange failure. Public HTTP 200 is not proof that the token POST
or its response succeeded. The collector remains PAUSED with one preserved page.

Implementation/report checkpoint `63d9191` was pushed to `feature/mt5-sync`.
No master merge, application deployment, startup registration or MCP activation
was performed by this checkpoint. A private screenshot records the actual stale
approval warning after capture; it is excluded from Git and deployment.

## Review and remaining gates

Plan alignment: PASS for this scoped failure diagnosis/transport increment.
Full MT5 coverage remains incomplete: unattended canonical publication, reviewed
source/manual-conflict workflows, reported local backlog, real startup invocation
and focused additional-account/interruption verification are not claimed complete.

System integrity: PASS for the scoped change. Money, canonical identities, reviews,
provenance, credential protection and database authority are unchanged. No UI or
design-system change, paid API, broker execution or original-terminal modification.

Production readiness: PENDING. Public verified HTTPS and local suites pass, but
live session restoration and pending-upload recovery must pass before restarting
normal operation. A restored session is not by itself proof of reconciliation.
Re-review the newest complete source/ledger snapshot before approving it again.
The 48-hour soak remains deferred by the user, not passed. MCP stays parked/off.

Sources: [Python 3.13 socket connections](https://docs.python.org/3.13/library/socket.html#socket.create_connection),
[HTTPS connection behavior](https://docs.python.org/3.13/library/http.client.html#http.client.HTTPSConnection).

## Resolved authentication and recovered upload — 2026-10-07

The worktree had returned to consolidated `master` (`c9d2a35`), which did not
contain the pushed failover implementation. Returned to the existing MT5 feature
branch (`5cf295c`) without modifying master or the user's untracked screenshot.
The operational Python modules load from this worktree: do not switch branches
under a running collector. This observation does not prove that the earlier
failed exchanges ran on the wrong branch; their recorded failures remain valid.

Added ignored, credential-safe diagnostic helpers. A Python request reached
discovery with verified TLS and HTTP 200, but later requests to application
metadata and the synthetic token endpoint failed during DNS/TCP dialing, before
TLS or HTTP transmission. Direct curl with proxies explicitly excluded showed
the same variability: discovery timed out, while a subsequent deliberately
invalid-code POST returned the expected HTTP 400 in 0.99 seconds with certificate
verification enabled. No real code/token was used or provider body logged by
these probes. This corroborates intermittent direct reachability, not a proven
PKCE, credential or grant rejection; it does not explain every prior failure.

One fresh traced PKCE attempt then completed successfully. Diagnostics recorded
only fixed endpoint labels, phases, HTTP status, duration, byte count and vault
state. They recorded no URLs with query parameters, request/response bodies,
codes, verifiers, tokens or provider error text. The unchanged production
validation and protected credential store were used:

- Discovery: verified TLS, HTTP 200, bounded JSON response read.
- Token POST: verified TLS, HTTP 200 in 0.55 seconds, JSON response read.
- Application session: authoritative signed/live-grant check HTTP 200.
- Protected vault: EXCHANGING followed by durably persisted READY.
- Independent second application session check: HTTP 200, exact same grant.

`authorize_traced_pilot.py` exited 0; the listener closed. No old code or refresh
token was replayed and no broader permission, new mapping or broker execution
was introduced. The previously blocking reauthorization gate is now passed for
this observed session, not a guarantee of future network availability.

The separately user-approved bounded coordinator check then exited 0. It started
PAUSED with one pending page, recovered it under a newer server fence, staged a
fresh observation and ended PAUSED with no attention code and pendingPages=0.
Both captured and server-confirmed checkpoints are 2026-10-07T14:51:30.826Z.
The last contact in that run was 2026-10-07T14:51:38.805Z. No automatic canonical
publication, orders or startup installation occurred.

`audit_recovered_outbox.py` opened SQLite in explicit read-only/query-only mode
and exited 0. Integrity is `ok`. The uncertain fence-3 attempt remains present,
superseded rather than deleted; the fence-5 replacement has a durable receipt.
The old page is acknowledged. Comparing the complete frozen envelopes after
excluding only operation ID, worker ID and fencing metadata proves identical
source facts. This is the fenced UNKNOWN/replacement recovery path, not a claim
that the original attempt was already COMMITTED.

Independent hosted readback confirms server fence 5 and the same checkpoint,
ACTIVE grant/version 2, eighty-six source-fact identities, twenty canonical trades
and twenty distinct canonical identities, USD 2032.53 net PnL, zero adjustments,
one publication approval and the preserved USD 100000 baseline/start date
21 September. The signed-in, freshly loaded browser preview corroborates
USD 102032.53 ledger/observed broker balance, proposed closed PnL change zero,
open-trade recognized cash zero, unexplained difference zero and no unresolved
cash/reconstruction issues. The old approval remains correctly stale after the
new checkpoint; no fresh onboarding approval was submitted automatically.

Private screenshots/diagnostics remain ignored and excluded from deployment.
This continuation changed documentation/preparation metadata only; no application
source or schema changed, and the earlier full regression results above were
not rerun or relabeled as newly passed. `git diff --check` passes for this update.

Next gate: explicit review/approval of the recovered current snapshot, followed
by the remaining implementation/operational gates listed above. This single
dedicated demo recovery does not complete real startup, additional-account,
unattended publication or full MT5 release verification. MCP remains parked/off.
