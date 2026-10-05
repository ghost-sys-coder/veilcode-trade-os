# MT5 cash attribution and captured-history approval verification

Date: 2026-10-05. Branch: `feature/mt5-sync`.
Baseline: pushed symbol-mapping checkpoint `860cc0f`.
This is an increment report, not MT5/MCP release completion.

## Implemented boundaries

- Decisions are explicit: opening funding already represented in the preserved
  baseline, a new account adjustment, an existing manually recorded adjustment,
  or a normalized-zero effect retained only as provenance. No default selection
  means approval. Linking creates no second financial effect.
- Signed cash is `profit + commission + swap + fee`, calculated with the central
  Decimal utilities and normalized once at configured account precision. Browser
  requests contain source IDs/revisions and decisions, never calculated amounts.
  The private database independently corroborates the proposed amount/date.
- Baseline funding must be positive BALANCE evidence before first captured entry,
  and the attributed total cannot exceed the preserved positive baseline.
  Later deposits cannot be absorbed into it. Existing baselines are not rewritten.
- New adjustments require type and performance treatment. Fixed types are neutral;
  OTHER requires explicit true/false. Credit facilities and unsupported broker
  events cannot be turned into deposits, trading credits or ignored evidence.
- Typed private cash decisions preserve source revision, signed amount, linked
  adjustment, actor, operation, reason and timestamp. They are immutable. A
  revised/already-classified movement is held for further financial reconciliation,
  not processed as another adjustment. Synced financial amount/type/date/ownership
  cannot be overwritten or deleted; explicit OTHER reclassification retains its
  existing audited workflow. Unsynced manual adjustment behavior is preserved.
- Account adjustment storage now uses unbounded finite PostgreSQL numeric rather
  than a fixed eight-decimal scale; precision-20 fixtures remain nonzero.
- Snapshot onboarding requires an explicit history/baseline acknowledgement and
  reason, complete capture, current source revisions, resolved cash, no unclassified
  OTHER adjustments, every reconstructed episode published with matching immutable
  execution evidence, and an ACCOUNT observation at/after the capture checkpoint.
  The normalized ledger plus open canonical cash must exactly match broker balance.
- An immutable approval stores source/ledger tokens, checkpoint, request and proof.
  Timestamp/status, proof, audit and receipt commit atomically. PAUSED stays PAUSED.
  New source, ledger or checkpoint evidence—or incomplete capture—makes the prior
  approval stale. This proves the captured snapshot, not broker lifetime completeness.
  Unattended canonical publication is not enabled by approval.
- Shared runtime-branded browser actors, live sessions/account-bound grants, feature
  flags, fixed private parameterized calls, optimistic version checks and durable
  request-hash receipts remain authoritative. Cash and approval retries look up
  receipts before loading a ledger changed by their own original mutation.
- UI shows normalized signed totals, resolved/stale attribution and evidence history.
  Snapshot-keyed forms reset acknowledgements when evidence changes. Existing
  Card/Input/Label/Button tokens are reused and recorded in the Imprint registry.

## Hand-calculated evidence

Database fixture:

`1000 baseline +250 deposit -50 linked withdrawal -5.13 charge +18 open-trade cash =1212.87`

The charge is `-5 + -0.125 = -5.125`, normalized once to `-5.13` USD.
Opening funding 1000 produces no adjustment. A normalized 0.004 USD movement
produces evidence only. At precision 20, -0.000000000000000001 remains nonzero.
Injected cash-audit failure rolls back the newly inserted adjustment. Injected
onboarding-audit failure rolls back both proof and completion marker.

Real local browser fixture:

`1000 baseline +95 closed net +250 deposit -50 linked withdrawal -5.13 charge -8 open-trade fees =1281.87`

Closed trade net is `100 -2 -3 =95.00`. Four still-open canonical trades each
have -2 source commission; their -8 bridge cash is not realized trading profit.
The browser publishes the remaining executions, classifies four cash records,
verifies only three adjustments, explicitly approves one snapshot, and confirms
that the paused collector remains paused.

The bridge additionally tests 1000.005 observed versus 1000.004 ledger at precision
2: normalized 1000.01 minus 1000.00 is 0.01, never a false rounded raw-difference zero.

## Verification commands

| Command | Result |
| --- | --- |
| `npm test` | PASS: 383 tests, 31 files |
| `npm run test:db -- --pending-migrations` | PASS: 441 assertions, 10 suites, pending DDL rolled back |
| `npm run test:db` | PASS: 441 assertions, 10 rollback-isolated suites; cash/onboarding 54 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next.js production build |
| `npm run check:mt5-python` | PASS |
| `npm run test:mt5-python` | PASS: 167 tests, 32.413 seconds |
| `npm run test:integration-browser` | PASS: 43 real local provider/browser/API checks |
| `supabase db push --local --yes` | Applied only the new cash/onboarding migration to disposable local Supabase |
| `supabase db lint --local --schema public,private --level error --fail-on error` | PASS |
| `supabase db advisors --local --type security --level error --fail-on error` | No issues found |
| `supabase db pull mt5_cash_onboarding_verify --local --schema public,private` | All 30 migrations replayed; no schema changes found. CLI no-diff exit 1, not an exit-0 pass |
| `supabase migration list --local` | All 30 migration files match local history |
| `git diff --check` | PASS |

Versions: Node 25.1.0, npm 11.6.2, Next.js 16.3.6, Python 3.13.2,
Supabase CLI 2.95.4, Chrome 154.0.8037.93, Playwright 1.63.0.
Ignored artifacts under `.artifacts/integration-tests/` include dark, light and
390px mobile views. Browser assertions check page-level horizontal overflow and
uncaught runtime errors; tables retain their own overflow container.

Development corrections: an early copied SQL fixture accidentally attributed
cash deals to position execution; its source filter and assertion count were
corrected before local application. A TypeScript fixture variable needed an
explicit result type. The first extended browser run read a previously visible
success notice before the next classification finished; it now waits for that
source option to disappear after commit/refresh, then verifies the durable record.
The final suites pass. Existing nonfatal Node module-type and Git line-ending
warnings remain; no secret/provider response is logged.

## Three-layer review and outstanding integration gates

1. **Plan alignment:** PASS for this increment's explicit cash decisions,
   baseline protection, reconciliation bridge and captured-snapshot approval.
2. **System integrity:** PASS for private database enforcement, decimal strings,
   atomic audit/receipts, preserved plans/reviews and shared visual tokens.
3. **Readiness:** local increment checks PASS; full MT5 release gate is pending.
   Revised-source financial reconciliation, manual-trade matching, unattended
   canonical updates, dedicated demo-terminal/account onboarding and actual
   startup/interruption checks remain outstanding. Hosted deployment and MCP
   protocol/client verification have not run. The deferred extended soak is not
   claimed as elapsed or passed.

No hosted Supabase schema/data, shared MT5 terminal, broker order, startup task,
`master` merge or parked MCP implementation was changed by this increment.
