# MCP local stdio adapter verification

Date: 2026-10-10. Branch: `feature/mcp-access`, fast-forwarded from the user's
consolidated master `853a963` (PR #24). Scope: checklist item 4 only.

## Delivered

- Official SDK 2.3.1 stdio serving (modern and legacy) forwards the existing
  stateless authenticated HTTP workflow. Same 84 tools/eight resources,
  schemas, decimal strings, paging, structured results and durable IDs.
- Trusted public configuration, exact resource/issuer discovery, public-client
  S256 browser authorization with one-use loopback/state validation, central
  asymmetric JWT verification and per-request remote live grant checks.
- Renewable credentials use the existing Windows DPAPI/ACL/atomic-write/OS-lock
  utility. Python helper has no broker/network/execution dependency. Tokens
  travel only through private process pipes, never argv/config/logs/Git.
- Serialized renewal durably invalidates the old secret before rotation, so
  lost acknowledgements/process death require explicit login rather than
  silently replaying potentially consumed refresh tokens.
- Protocol-only stdout, sanitized stderr, cancellation propagation, prompt EOF
  cleanup, no uncertain mutation retries and no cached protected-resource bypass.
- Setup/recovery runbook in [the adapter README](../integrations/mcp/README.md).

No schema migration, new hosted OAuth client, hosted data mutation, enablement,
production promotion, collector restart or broker order was made by this build.
The user's outstanding `domain/mt5/cash.ts` formatting and snapshot are included
as requested. The existing `.vercelignore` still excludes that snapshot from
the hosted public assets; Git inclusion does not change that rule.

## Verification evidence

Runtime: Windows, Node 25.1.0, Python 3.13.2, Chrome 154.0.8037.99,
TypeScript MCP server/client SDK 2.3.1, Next.js 16.3.8.

The focused `npm run test:mcp-stdio` provider/browser/subprocess gate verifies:

1. Anonymous discovery/calculator and protected MCP challenge.
2. Existing real browser consent creates application-wide MCP access, no MT5 mapping.
3. S256 enforcement, signed resource binding and denial at the MT5 resource.
4. Modern/legacy HTTP parity and the independent sizing fixture.
5. The adapter's own real browser authorization/reconnect and loopback exchange.
6. Real user-DPAPI encrypted bytes, profile locking and no plaintext token file.
7. Actual legacy stdio 84 tools/eight resources, money resource and calculator.
8. Modern subprocess restart, same-operation replay, changed-payload rejection,
   null/omission preservation, stale versions and one database effect.
9. Remote disablement denies both fresh tool discovery and a previously read
   resource; re-enablement restores access without weakening validation.
10. Real token rotation, protected persistence/restart and clean disconnected
    startup with no token/protocol leakage.

Sizing cross-check: USD 100000 × 1% = USD 1000 risk; EURUSD entry 1.1000 minus
stop 1.0980 = 0.0020; a 100000-unit lot risks USD 200; volume = **5.00 lots**.
Stdio preserves the exact shared calculation, not a new arithmetic algorithm.

The first subprocess attempt exposed a discovery-path mismatch. It was fixed
using only the two pinned provider paths; no host/issuer validation was relaxed.
The adapter-login test initially expected another approval button even though
the existing consent workflow safely resumes active grants. That test assumption
was corrected without revoking/remapping or rebuilding existing consent.
The first combined regression left the parent browser on the loopback receipt,
so its later sign-out assertion could not find the workspace button. The
sub-fixture now restores the original workspace page; the complete rerun passes.

Final local results:

| Command | Result |
| --- | --- |
| `npm test` | PASS: 1014 tests, 61 files (31 stdio cases) |
| `npm run test:db` via the disposable hint wrapper below | PASS: 1078 assertions, 27 suites |
| `npm run test:mcp-stdio` | PASS: 10 checks; actual Node process termination/restart included |
| `npm run test:mcp-integration` | PASS: 72 complete provider/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 65 existing authentication/MT5/manual/public-page checks |
| `npm run test:mcp-python` | PASS: six actual native Windows helper tests |
| `npm run check:mcp-python` | PASS: Ruff and compileall |
| `npm run test:mt5-python` | PASS: 176 existing Python tests |
| `npm run check:mt5-python` | PASS: existing Python static checks |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, no lint warnings |
| `npm run build` | PASS, Next.js 16.3.8 production build |
| `git diff --check` | PASS |

Database command wrapper:
`node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm`, which invokes
`npm run test:db` and restores the disposable diagnostic setting afterward.
It never uses Production `.env` as a test database fallback. All fixture
records/clients/files are disposable; the hosted database was not modified.

## Review and limitations

Architecture skill kept this a transport-only adapter of approved workflows;
Supabase skill informed pinned discovery/token validation and live authorization.
Review covers plan alignment, system integrity and increment readiness. No UI
or monetary contract was changed; permanent deletion is still browser-approved.
All three review layers pass for this increment. Actual client/release gates
below remain explicit limitations, not a claim that the entire MCP feature ships.

- Windows only for local credential protection; no insecure cross-platform
  fallback. Other systems may use the separate remote transport when verified.
- One adapter per profile; separate registered client/profile for concurrent clients.
- An uncertain rotation deliberately requires browser reconnection. Offline
  operation is not promised: the Trade OS server is required, MT5 is not.
- The existing Node module-type diagnostic goes to stderr, not protocol stdout.
- The real browser test uses Chrome automation. Default-browser launch/client
  installation behavior is verified with the actual clients in the next build;
  manual URL fallback and a bounded launch helper are provided.
- Actual Codex, Claude Code, ChatGPT Desktop/remote, Claude remote and Gemini CLI
  acceptance is **pending**, not implied by official SDK subprocess tests.
- Hosted MCP stays disabled. Local passing tests do not authorize enabling it,
  new hosted clients, Production promotion or the broader MT5 operational rollout.

Next: completion checklist item 5 (pre-registered clients and actual client
matrix), followed by item 6 (final hosted acceptance/approved activation).
