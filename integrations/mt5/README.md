# MT5 collector foundations (not an operational collector yet)

Python 3.13.2; no terminal attachment or broker execution. This directory currently
contains strict source boundaries, the account-bound durable SQLite outbox,
authenticated HTTP transport/uploader, a read-only dedicated-terminal adapter,
PKCE/Windows-protected renewable credentials, bounded process supervision and a
local polling coordinator. Operational consent/startup commands and Task Scheduler
installation remain pending. This is not a released unattended worker.

## Development verification

From the repository root:

```powershell
python -m pip install --no-cache-dir --target .artifacts/python-tools -r integrations/mt5/requirements-dev.txt
npm run test:mt5-python
npm run check:mt5-python
```

The checker uses the project-local ignored tool directory, not a global install.
Python source validation preserves decimal strings and uint64 broker IDs. It does
not calculate authoritative PnL, classify outcomes, invent plans, or complete reviews.

## Outbox contract

- One disk-backed spool is bound to owner, Trade OS account and connection. The
  first captured terminal identity is retained; a switched identity is rejected.
- A collector must verify identity both before and after broker reads. Only after
  complete successful collection does it call `enqueue` with all frozen pages.
  `None`/failed history or position queries are never successful empty history.
- WAL and FULL synchronization are verified. Every collection, all page contents,
  and local capture cursor commit together. The server-confirmed cursor is separate.
- `next_attempt` commits an operation UUID, exact envelope and local integrity hash
  before returning a request to upload. Normal retries reuse that exact envelope.
- A page acknowledgement must belong to the connection/collection and reflect a
  staged receipt. Only an explicitly complete collection receipt with a non-null
  server checkpoint advances the local server-confirmed cursor. An older incomplete
  server collection can hold that cursor even when this collection is complete.
  The checkpoint is server-derived, never inferred from a page's index or timestamp.
- On uncertain upload after lease expiry, first obtain a NEW server fencing generation,
  then query the old operation through authenticated operation lookup. COMMITTED means
  acknowledge its original result. UNKNOWN is a point-in-time observation, not proof
  against future writes; only the new fence makes the old worker unable to commit.
  `recover_unknown` requires that larger generation and preserves the old attempt,
  while atomically storing a new operation/envelope for the same immutable slot.
- Keep the database and WAL together; do not copy a live main file alone. A future
  support/backup command must use SQLite's backup API or a fully stopped worker.
  Never delete a pending spool to recover a connection, silently reset corrupt files,
  or apply an account's spool to another connection. Corruption requires attention.
- Local spools are not encrypted credential stores. Tokens, passwords and private
  keys are forbidden here and in source payloads. User-scoped DPAPI and protected
  connection/vault directory ACLs are implemented; native restart and injected
  disk-write-failure tests pass. Cross-user, locked-session and reboot behavior
  still require actual operational verification. Use local disk, not a network
  share or cloud-synchronized directory.

Sources: [Python sqlite3 transaction API](https://docs.python.org/3.13/library/sqlite3.html),
[SQLite WAL](https://www.sqlite.org/wal.html),
[SQLite synchronous modes](https://www.sqlite.org/pragma.html#pragma_synchronous).

## HTTP transport and recovery

`IntegrationApi` receives an explicit application origin and an access-token provider.
Production requires HTTPS with certificate verification. Plain HTTP is allowed only
for explicitly opted-in loopback tests. Environment/registry proxies and redirects
cannot route the bearer token elsewhere. Responses are bounded and JSON validated;
errors expose stable codes, never provider bodies or tokens. The socket timeout is
not a whole-operation deadline: the implemented supervisor bounds each worker to
45 seconds after process creation (with bounded termination/pipe cleanup).

`Uploader` checks owner/account/purpose/resource against the live session before a
lease claim. Lease requests are durable too: lost acknowledgements replay the same
operation ID. A replayed expired lease is recorded before claiming a fresh operation.
Lease renewal is due after 30 seconds, with a 15-second expiry margin. An expired
uncertain capture requires a higher server fence before operation lookup; COMMITTED
acknowledges the old receipt, UNKNOWN creates an audited replacement envelope for the
same slot. Auth, TLS, mapping and payload conflicts require attention; only transient
network/server/lease contention errors are retryable. Jittered exponential retry
delays are capped at 60 seconds; the coordinator now applies them without sleeping
inside a tick. Native broker reads stop during upload outages; recovery drains the
outbox first, then retrieves overlapping history instead of accumulating unlimited
new captures while offline.

The browser verification runner now invokes actual Python subprocesses with the
local signed token supplied on stdin, never command arguments or files. It checks
both lost-acknowledgement and never-committed recovery against the real local API.
`verify_local_api` is a disposable test fixture, not an operational command.

## Read-only dedicated-terminal boundary

`ReadOnlyTerminal` requires an explicitly approved absolute executable, expected
terminal data directory and demo identity. It never auto-discovers an installation,
calls `login`, provides broker credentials, selects another saved account, or invokes
order placement/check/modification/cancellation. The expected installation path,
data path, broker server/login, currency/precision and hedging/netting mode must match.
`initialize` may start only that configured terminal; `shutdown` disconnects the
Python API, not the terminal process. No real terminal has been attached in verification.

Every query is bracketed by identity checks, with another check before returning a
frozen collection. `None`, disconnected or failed reads are errors, not an empty
position list or closure. All-history onboarding starts at the Unix epoch; subsequent
reads overlap the captured checkpoint by five minutes, and `full_history` supports
the daily wider reconciliation. Scheduling/onboarding approval remain separate work.

Native numeric facts become validated decimal strings without account-currency
rounding or authoritative Python PnL calculations. Position identifiers and tickets
remain separate uint64 strings. Current stops/targets stay observations. Unknown
deal/order codes and canceled/credit deals remain source evidence for server review;
credit facilities are not relabeled as trading credits or deposits. Unsupported
position types and duplicate source identities require attention. First implement
approved onboarding and operational startup before operating this adapter.

Sources: [MetaQuotes initialize](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py),
[account info](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py),
[terminal info](https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py),
[history deals](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py).

## Protected renewable credentials

`OAuthClient` uses public-client PKCE S256, explicit state, exact registered IPv4
loopback callbacks and an intended resource. It checks discovery compatibility and
uses the application's signed/live-grant session check before accepting credentials.
Decoded JWT claims are validation hints, not authorization. Both standard JWT
audience strings and audience arrays are accepted only with the intended resource.
No AI-provider keys, service-role keys, broker passwords or client secrets are used.

The default vault is `%LOCALAPPDATA%/TradeOS/credentials`, outside Git. Record names
and DPAPI context bind issuer/resource/owner/account/client. The protected DACL
allows only the current Windows user and SYSTEM. Encryption is user-scoped, not
machine-wide. Only encrypted bytes reach the atomic same-volume replacement file;
native temporary buffers are cleared. Python immutable secrets cannot be guaranteed
to be erased from process memory. Never copy this vault to another Windows identity.

Refresh is persisted as uncertain before sending. New rotated credentials replace
the old record atomically only after server verification. If the provider omits a
new refresh token, retain the previous one. A lost refresh response, interrupted
exchange or failed credential persistence requires fresh consent; never blindly
replay a possibly consumed refresh token. No OAuth-server refresh-reuse guarantee
is assumed from browser-session behavior. A consent callback listener is not yet
shipped; `verify_local_oauth` is a strictly local disposable test fixture.

## Bounded supervision and coordinator

`supervised_capture` and `supervised_upload` invoke only the fixed Python worker
module, not arbitrary commands. JSON input/output are bounded and validated, stdout
noise cannot grow without limit, and stderr is discarded rather than leaking broker
facts or credentials. Ctrl+C/timeouts stop only the owned Python process. An unnamed
Windows job kills that worker if its supervisor dies; child processes silently break
away so a terminal is not killed by this job. Failure to establish containment
requires attention; there is no unprotected fallback. Other software's job policies
and actual terminal launch behavior still require operational verification.

`Coordinator` owns a connection-scoped OS lock and restricts only that approved
directory's ACL. It provides an interruptible `run_until_stopped` loop, or individual
`tick` calls returning the next wait. It polls every 15 seconds after capture,
heartbeats at least every 30 seconds when idle, reports stale at 120 seconds and
performs wider history reconciliation daily. Captures/uploads themselves also renew
the server lease. Pending pages drain before more native reads; sleep/wake rechecks
the lease rather than running a missed-poll catch-up storm.

Outbox version 3 adds durable PAUSED/RUNNING/ATTENTION controls, contact/reconciliation
timestamps and append-only local control/generation evidence. New spools are PAUSED.
Only an explicit operator action resumes them; restart never clears attention.
Each coordinator lifetime generates a new worker ID, including after copying a
stopped/SQLite-backed-up spool to a VPS. Existing uncertain operations are unchanged:
takeover waits for the old 120-second lease to expire, obtains a higher server fence,
then looks up/reconciles old effects. Never reuse another running collector's ID.

Unknown errors, account switches, revoked/uncertain authentication, disk failures
and malformed replies require attention. A UTC clock earlier than the existing
capture cursor requires clock repair and explicit resume; the cursor is not rewound.
These local controls do not replace private server grants, RLS, leases or future
application pause/resume workflows. Monitoring UI and Task Scheduler remain pending.

See [the exact verification report](../../docs/MT5_CREDENTIALS_SUPERVISION_VERIFICATION.md).
