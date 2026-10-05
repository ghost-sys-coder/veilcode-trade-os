# MT5 collector foundations (not an operational collector yet)

Python 3.13.2; no terminal attachment or broker execution. This directory currently
contains strict source boundaries and the account-bound durable SQLite outbox.
The authenticated HTTP uploader, broker adapter, PKCE/Windows-protected renewable
credentials, supervisor and Task Scheduler installation are still pending.

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
