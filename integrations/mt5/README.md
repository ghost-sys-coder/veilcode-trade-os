# MT5 collector foundations (not an operational collector yet)

Python 3.13.2; no terminal attachment or broker execution. This directory currently
contains strict source boundaries, the account-bound durable SQLite outbox,
authenticated HTTP transport/uploader, and a read-only dedicated-terminal adapter.
PKCE/Windows-protected renewable credentials, the supervisor, continuous scheduling
and Task Scheduler installation are still pending. This is not an unattended worker.

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
  keys are forbidden here and in source payloads. Windows access controls, DPAPI
  credential storage, disk-full recovery and locked-session behavior still require
  implementation/verification before operational use. Use local disk, not a network
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
not a whole-operation deadline: a future supervisor must bound stalled/trickling calls.

`Uploader` checks owner/account/purpose/resource against the live session before a
lease claim. Lease requests are durable too: lost acknowledgements replay the same
operation ID. A replayed expired lease is recorded before claiming a fresh operation.
Lease renewal is due after 30 seconds, with a 15-second expiry margin. An expired
uncertain capture requires a higher server fence before operation lookup; COMMITTED
acknowledges the old receipt, UNKNOWN creates an audited replacement envelope for the
same slot. Auth, TLS, mapping and payload conflicts require attention; only transient
network/server/lease contention errors are retryable. Jittered exponential retry
delays are capped at 60 seconds; the scheduler that applies them is still pending.

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
supervision, credentials and approved onboarding before operating this adapter.

Sources: [MetaQuotes initialize](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py),
[account info](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py),
[terminal info](https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py),
[history deals](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py).
