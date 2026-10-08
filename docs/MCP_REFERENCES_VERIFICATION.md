# MCP tags and owned instruments — verification

2026-10-08 · `feature/mcp-access` · based on `9500ddd`.
Implemented and verified on `feature/mcp-access`. The user-approved hosted
schema rollout is complete (see below); source publication is authorized.
Application deployment/hosted browser verification remain pending. Hosted MCP stays disabled.
This increment is not full MCP readiness.

## Delivered

- Eight tools bring coverage to **48 HTTP tools / five resources**:
  `tradeos_references_list/get/create/patch/archive` and
  `tradeos_trade_tags_list/assign/remove` (each suffix is a separate tool).
- Strict typed services and private invoker-only transactions serve both MCP
  and the existing browser tag forms. Every write has a durable operation ID,
  atomic request hash/result/audit and optimistic versions. Live actor/session/
  grant checks precede reads and receipt replay; owner IDs are never caller inputs.
- Tags retain friendly case and the existing database-generated normalized
  uniqueness per user. Archived names remain reserved. Historical associations
  survive archival; new assignment is rejected, explicit removal remains audited.
- Assignment/removal checks both trade and tag versions, returns `tradeVersion`
  and advances the private canonical version, including direct association writes.
- Global instruments are readable, never mutable through MCP. Owned instruments
  support create/read/patch/archive. Referenced symbol/class/currencies/pip size/
  price precision cannot silently change, including direct database updates.
  References include trades and MT5 mapping/history. Display labels remain editable.
- Archival keeps trade IDs and broker mapping evidence. Historical inactive
  instruments remain visible in detail/edit; edit choices include active records
  plus the current instrument. Creating an instrument never infers broker mapping.
- Pip sizes are validated decimal strings: up to 14 integer / 10 fractional digits,
  independently of currency precision. Invalid scale, zero, negative, exponent
  notation and numeric JSON are rejected rather than rounded silently.
- Stable bounded cursors; browser tag libraries exhaust all pages. Journal filters
  retain historical archived labels. Existing form layout is unchanged.
- Permanent deletion is **not exposed**; exact-target/version, one-use browser
  confirmation is a separate remaining build. Never delete immutable financial,
  correction or audit evidence through MCP.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | PASS: 703 tests / 50 files |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next16.3.6 compile, TypeScript, 32/32 static pages; public calculator stays static |
| `npm run build:verified` (after approved hosted rollout) | PASS: hosted21/13 prerequisite check, production compile, TypeScript and32/32 pages; no deployment |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` | Executes `npm run test:db`; PASS: 784 assertions / 20 suites, including 67 reference/security assertions |
| `npm run test:mcp-integration` | PASS: 32 real local OAuth/browser/official SDK checks, zero uncaught client errors; fixtures cleaned |
| `npm run test:integration-browser` | PASS: 65 local auth/MT5 browser/Python-recovery regressions, zero uncaught client errors; fixtures cleaned |
| `npm run test:mt5-python` | PASS: 176 tests |
| `npm run check:mt5-python` | PASS: all static checks |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS: 21 functions / 13 version-order columns |
| `supabase db advisors --local --type security --level warn --fail-on error --output json` | PASS: no warning/error-level security issues |
| `git diff --check` | PASS |

Browser: Chrome154.0.8037.93. Official MCP SDK2.3.1; modern `2026-07-28` and
legacy negotiation verified. These SDK fixtures are **not** real Codex/Claude/
Gemini/ChatGPT-client evidence. The temporary local Supautils diagnostic-hint
workaround was restored in `finally`; no permission test was skipped.

New real HTTP checks cover concurrent reference creation/assignment, identical
receipts, changed-payload rejection, duplicate case variants, stale browser/MCP
edits, browser create/remove/reassign, archived-label history, global read-only
instruments, exact pip size, complete paging and retained historical display.
Refresh, current-browser-only logout and immediate revocation still pass.

Hand calculations: pip `0.0000000001` remains exact on a two-decimal account.
The closed partial trade stays **10.20 − 0.10 − 0.10 = 10.00**, `PARTIAL_WIN`,
**0.10R** with 100.00 planned risk. Every gross/cost/credit/net/R/outcome field
was compared before and after tag operations and remained unchanged.

Initial test defects: fixture `start_date` corrected to `started_at`; browser
selector adjusted for the required-field asterisk; financial assertion corrected
from storage-scale `10.00000000` to normalized `10.00`. Failed runs were not
counted as passes. Instrument-only trigger fields were separated from tag fields.

## Release boundary and review

Migration `20261008173537_mcp_tags_instruments.sql` was scaffolded with
`supabase migration new mcp_tags_instruments`, tested transactionally, then applied
only to disposable loopback Supabase for the initial browser verification.
After the user approved the hosted rollout, it was also applied to the Trade OS
project as documented below. No application-data deletion, real-terminal action,
collector change, production flag change, broker execution or model-provider API
invocation occurred.

The release gate now requires 21/13 prerequisites and passes against hosted
Supabase. Do not bypass `build:verified`. Source publication/deployment and
authenticated verification of this new code on the hosted site remain pending.

### Approved hosted rollout — 2026-10-08

- Account: **VeilCode Studio@Zooloop.tv@gmail.com**. Project:
  **nhwlxcrsivmawwmjiwck**. Only the tested reference migration was authorized/applied.
- Connector `supabase_apply_migration` returned success. The rollout used a
  transactional existing-row fingerprint guard across accounts, trades,
  instruments, tags and associations, excluding only newly added reference
  version/archive columns in the after-state. Guard passed; lock timeout5s,
  statement timeout30s. No hosted fixtures or workflow mutations were performed.
- Counts before/after: **5 accounts, 21 trades, 14 instruments, 0 tags and
  0 tag associations**. Existing reference metadata initialized to version1,
  unarchived. Original instrument fields, account balances and trade records
  remained identical in the transactional fingerprint comparison.
- RLS remains enabled on all three reference/association tables. All seven new
  private functions deny EXECUTE to anon/authenticated/service_role. Only the
  two enforcement triggers are security-definer; application read/write functions
  are security-invoker. Empty/anonymous claims reject reads and both writers
  with42501 even on the server connection; the denial checks were rollback-only.
- The connector initially recorded rollout metadata as
  `20261008180527_mcp_tags_instruments_approved_rollout`. An exact version/name/
  complete-SQL guard reconciled **only that row** to the repository source version
  **20261008173537_mcp_tags_instruments**, storing the reviewed source SQL. This
  prevents a future CLI migration push from replaying the already-applied schema.
- Hosted `npm run build:verified` prerequisite inventory now passes **21 functions
  /13 version-order columns**; the subsequent local production build passes.
- No hosted MCP resource row exists; enablement remains false. No grant/resource
  creation, collector pause/resume or Vercel deployment was undertaken.
- Hosted security advisors reported existing private deny-by-default RLS INFOs
  and the pre-existing [leaked-password protection disabled warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
  No new schema/security warning was introduced. Auth settings were not changed.

Architecture and review skills guided the shared actor-aware services, database
ownership/history protection and verification. Plan alignment and system integrity
passed for this increment; local readiness passed. No new visual pattern introduced.

Remaining: computed journals; analytics/calendar/behavior/filtered exports;
screenshots/private files; MT5/import actor access; profile; permanent deletion;
local stdio; actual external-client matrix; hosted MCP activation and final gates.
