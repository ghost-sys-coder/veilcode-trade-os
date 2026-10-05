# MT5 explicit broker-symbol mapping verification

Date: 2026-10-05. Branch: `feature/mt5-sync`.
Baseline: pushed precision/runtime checkpoint `464b0d4`.
This report covers one verified increment, not MT5 or MCP completion.

## Implemented behavior

- The onboarding preview offers explicit captured broker-symbol → Trade OS
  instrument decisions, with a meaningful reason and no default approval.
  Instrument options show symbol, display name and catalog/owner scope.
- Unique exact symbols still resolve normally. Broker suffixes and approximate
  names are never guessed. Explicit maps override exact matching; an unavailable
  approved instrument holds publication rather than falling back silently.
- Typed private current mappings and append-only decision events retain original,
  previous and new instrument IDs, version, reason, actor, operation and timestamp.
- The server verifies the browser actor; the database checks its live session,
  ownership, active account-bound demo grant, source fingerprint and connection
  version. Only fixed parameterized private calls can mutate mappings.
- Mapping, current-value update, connection version, audit and operation receipt
  commit atomically. The shared operation advisory lock serializes identical
  retries; changed payloads with the same operation ID are rejected.
- Unpublished mappings can be explicitly corrected. Once execution has been
  published for a broker symbol, reassignment to another instrument is rejected.
  No normal workflow can delete mapping decisions or the current mapping.
- Publication accepts only the current approved mapping or one unambiguous exact
  symbol. Canonical trades reference the selected instrument while immutable
  execution evidence retains the raw broker alias. No prices, volumes, monetary
  values, original plans or reviews are converted or fabricated.
- Manual overlap checks compare the mapped canonical symbol. A plausible manual
  match remains held even when the broker uses an alias or another catalog record
  shares that symbol. Mapping does not resume a paused collector or approve
  account reconciliation/unattended synchronization.

## Fixtures and verification

The new SQL fixture captures `EURUSD.m` and attempts publication into EURUSD.
Without a map it fails. Explicit map versions retain EURUSD → EURUSD → GBPUSD →
EURUSD decisions before publication; after publication GBPUSD reassignment fails.
Injected failure while writing history leaves no map or durable operation receipt.
Expired sessions, revoked grants, OAuth collectors, non-owners and anonymous
callers cannot approve mappings.

The real local browser fixture captures an unresolved EURUSD.m position, confirms
that no publication checkbox exists, selects EURUSD and supplies a reason, then
publishes one OPEN canonical trade. Its instrument is EURUSD, its immutable raw
symbol is EURUSD.m, and finalized net PnL remains null. The preceding complete
trade still matches `100 - 2 - 3 = 95.00` USD; alias mapping changes no finance.

| Command | Result |
| --- | --- |
| `npm test` | PASS: 354 tests, 29 files |
| `npm run test:db -- --pending-migrations` | PASS: 383 assertions, 9 suites before local application (initial 37 mapping assertions) |
| `npm run test:db` | PASS: 387 assertions, 9 rollback-isolated suites, including 41 mapping assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next.js production build |
| `npm run check:mt5-python` | PASS |
| `npm run test:mt5-python` | PASS: 167 tests, 24.506 seconds |
| `npm run test:integration-browser` | PASS: 41 real local provider/browser/API checks, repeated with mapping screenshots |
| `supabase db push --local --yes` | Applied only `20261005180936_mt5_symbol_mapping.sql` to disposable local Supabase |
| `supabase db lint --local --schema public,private --level error --fail-on error` | PASS |
| `supabase db advisors --local --type security --level error --fail-on error` | No issues found |
| `supabase db pull mt5_symbol_mapping_verify --local --schema public,private` | All 29 migrations replayed; no schema changes found. CLI exits 1 for this no-diff result, not an exit-0 pass |
| `git diff --check` | PASS |

Versions: Node 25.1.0, npm 11.6.2, Next.js 16.3.6, Python 3.13.2,
Supabase CLI 2.95.4, Chrome 154.0.8037.93, Playwright 1.63.0.
Dark, light and 390px mobile mapping screenshots are under ignored
`.artifacts/integration-tests/`; visual inspection confirms shared token-based
Cards/controls and internal table scrolling, without page-level mobile overflow.
The Imprint registry records the form's shared visual patterns.

During development, a migration text-construction error caused a parser failure
in rollback-only tests; a fixture parameter/column name collision then produced
incorrect test inputs. Both were corrected before applying the migration. The
final suites pass. The existing non-fatal Node module-type warning remains.

## Three-layer review and remaining release gates

1. **Plan alignment:** explicit symbol resolution, provenance, deterministic
   canonical identity and recoverable audited changes pass for this increment.
2. **System integrity:** private database enforcement, verified actors, decimal
   boundaries, preserved plans/reviews and shared UI tokens pass.
3. **Readiness:** local mapping fixtures, real browser behavior, error paths and
   regression checks pass. Full MT5 readiness is **not passed**: cash/funding
   classification, full onboarding approval, source/manual conflict resolution,
   unattended canonical updates and focused dedicated-demo-terminal/startup
   verification remain required. Hosted deployment and MCP clients are untested.

No hosted schema/data, existing terminal, broker order or startup task was changed.
The isolated SDK runtime is available from the prior checkpoint, but a dedicated
demo terminal/account has not been attached. The user's 48-hour waiting-gate
deferral remains in effect; elapsed soak time is not claimed. `master` and the
parked MCP branch remain unchanged by this increment.
