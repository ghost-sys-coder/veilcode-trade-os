# MCP controlled private files — verification

2026-10-09, `feature/mcp-access`, baseline `a30c5f3`. Completion-checklist item 2
only. Seven new file tools bring the actual HTTP catalog to **80 tools and seven
resources**. Permanent deletion, stdio, actual external clients and hosted MCP
activation are not part of this increment.

## Delivered contract

- `tradeos_screenshots_list/get`: owner-scoped metadata, keyset pages of 1–100.
- `tradeos_screenshot_upload_request/status`: durable exact-object reservation,
  current version, received chunk indexes, expiry and explicit completion state.
- `tradeos_screenshot_upload_chunk`: 393,216-byte maximum, canonical base64,
  server-calculated size/hash, immutable chunk manifest and retry-safe receipts.
- `tradeos_screenshot_upload_finish`: read/hash every ordered chunk, validate the
  complete image, store original bytes without overwrite, then atomically commit
  screenshot metadata, canonical trade version, operation receipt and audit.
- `tradeos_screenshot_download`: authenticated bounded base64 chunks, exact hash
  continuation and fresh authorization after external I/O. No signed URLs returned.
- `tradeos://v1/files`: schemas, limits, resume/version/retry guidance and legacy
  integrity semantics. Existing browser attachment rendering/upload remains supported.

Only single-frame PNG/JPEG/WebP within **10,485,760 bytes and 16,000,000 pixels**
are accepted. Magic headers, full image decoding, byte length and SHA-256 are
checked centrally. No external URLs, arbitrary paths/owners, SQL, shell, broker
execution or AI-provider API calls. Reservations/placeholders are not evidence.

Private manifests/chunks deny direct browser/OAuth/service-role access. New
workflows are private security-invoker functions with empty search paths and
revoked client execution. Existing restrictive OAuth table/Storage policies stay
intact. Browser API writes cannot insert, overwrite, remove or relabel data into
the managed `owner/trade/mcp/...` namespace. Original browser paths remain supported.

## Deterministic byte and ledger evidence

The native fixture generates a 512×512 RGB PNG with seed 42 and no PNG compression:

- Total: **788,300 bytes**; chunks **393,216 + 393,216 + 1,868**.
- SHA-256: `18f589259568f4e0eefbab622c010bbc0d08bb914001368da37524049ff41611`.
- Uploaded out of order, restarted from persisted status, and reconstructed from
  download chunks to exact original bytes/hash. The existing trade browser renders it.
- A deliberately lost Storage acknowledgement and concurrent identical requests
  produce exactly three manifests, one attachment and one effect per operation.
- Changed payloads and stale upload/trade versions reject. Injected audit failure
  leaves the upload pending, with no metadata, receipt or trade-version effect;
  retry verifies the already stored original before committing once.
- The disposable account remains **USD 1,000.00**, with zero adjustments. No
  trading result, plan, behavioral review or real account is manufactured or changed.
- Legacy metadata retains unknown original hash; current validated download is
  explicitly `LEGACY_VALIDATED_ON_READ`. Changed bytes reject hash continuation.
- Kill switch and revoked current grant deny downloads and old receipt recovery.

The SQL suite uses synthetic Storage metadata to test transactions/permissions;
it does **not** prove image decoding. Actual Sharp unit tests and the native
Storage/OAuth/browser fixture provide that separate byte-level evidence.

## Commands and results

| Command | Result |
| --- | --- |
| `npm test` | PASS: **941 tests, 58 files** |
| `npm run test:db` via `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` | PASS: **1,029 assertions, 26 suites**; includes **45** private-file assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS, including anonymous static calculator |
| `npm run test:mcp-integration -- --files-only` | PASS: **12** focused real-provider/official-SDK/Storage/browser checks |
| `npm run test:mcp-integration` | PASS: **59** complete real-provider/SDK/browser checks |
| `npm run test:integration-browser` | PASS: **65** browser/MT5 checks, no uncaught client errors |
| `npm run test:mt5-python` | PASS: **176** tests |
| `npm run check:mt5-python` | PASS |
| `supabase db advisors --local --type security --output json` | PASS: no issues found |
| `supabase migration list --local` | PASS: canonical private-file version present, history aligned |
| `supabase db pull private_file_local_verification --local --schema public,private --yes` | All 46 migrations replayed; no schema changes. CLI returns 1 for this no-change pull; no duplicate migration created |
| `supabase db diff --local --schema public,private` | PASS: full shadow replay, no schema changes, exit 0 |
| `npm run build:verified` | PASS: hosted **33 functions / 14 version/order columns**, then production build |
| `npm audit --omit=dev --json` | PASS: **zero production vulnerabilities** |
| `node .artifacts/mt5-pilot/check-private-file-client-assets.mjs` | PASS: secret absent from **38** client JS/CSS/map assets; no value printed |
| `git diff --check` | PASS |

The database wrapper only suppresses inherited local `supautils.hint_roles`
diagnostics during rollback-isolated tests and restores the setting afterward;
it does not weaken permissions. No hosted database was used for test fixtures.

Versions: Windows, Node **25.1.0**, Python **3.13.2**, Next.js **16.3.8**, official
MCP SDK **2.3.1**, Sharp **0.35.5**, Supabase CLI **2.95.4**, PostgreSQL **17.6**,
Docker engine **28.0.1**, Chrome **154.0.8037.99**. Next and eslint-config-next
were minimally patched from 16.3.6 after the production dependency audit;
no broad force upgrade was performed.

## Failures found and corrected

The native gate exposed stalled immediate reads after a full-size duplicate
Storage POST in the local gateway/server path. It was isolated with sanitized
phase, socket and exact-object probes; provider credentials/payloads never printed.
Binary transfer now uses native HTTP with explicit body lengths, independent
sockets, no redirects, bounded response streaming and absolute deadlines.
Duplicate **staging** is not declared verified evidence: the atomic writer must
corroborate stored type/size/hash, and finish still hashes/decodes actual bytes.
Existing originals are byte-verified before another no-overwrite POST. Supabase's
wrapped 404 response is distinguished from authorization errors. Open-ended
authenticated ranges avoid requesting beyond smaller images, while response
headers and stream bytes remain strictly capped. Added direct transport tests.

The fixture's nonexistent `trades.notes` field was corrected to
`confirmation_notes`. Security review additionally closed managed-namespace
browser insertion/relabeling and verified exact chunk coverage before finish.
Final tests passed after those fixes, not merely before them.

## Approved hosted prerequisites

- Correct project: `trade-os`, `nhwlxcrsivmawwmjiwck`, under
  **VeilCode Studio@Zooloop.tv@gmail.com**. Applied the exact tested migration;
  guarded history alignment uses canonical **20261009112200**.
- All **54 existing public/private application table counts and content hashes
  are unchanged**. New upload/chunk tables are empty; new staging bucket is
  private, octet-stream only, with a 393,216-byte object cap. Original screenshot
  bucket/type/10 MiB limit is unchanged.
- Verified private RLS, empty function search paths, invoker mode and no
  anon/authenticated/service-role execution. Existing pilot remains ACTIVE/v20;
  collector/startup/policy/grants/mapping were not touched.
- Hosted MCP remains unavailable: no enabled MCP resource was introduced. The
  existing MT5 resource stays enabled. No flags, master merge or production
  promotion occurred.
- User-added secret validated using read-only existing bucket metadata only.
  Vercel metadata confirms `SUPABASE_SECRET_KEY`, type **sensitive**, target
  **Preview only**, branch **feature/mcp-access**, correct project/team. The value
  was passed by stdin, never command arguments, chat, Git or a credential artifact.
- Source push and exact Preview READY evidence are recorded below after deployment.

Hosted advisors report no ERROR. Existing
[leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
and **31** existing
[RLS InitPlan warnings](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
remain unchanged. **25**
[private deny-by-default RLS INFO notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
include the two new private tables intentionally lacking client policies.
There are **10** pre-existing unindexed-FK INFO findings (none for the new file
tables); new indexes being unused before rollout is not a reason to remove them.

## Review and explicit limitations

Specification: exact content evidence, revocation, canonical ownership, retry/
version/audit contracts and monetary/review history are preserved. Architecture:
shared verified services, privileged Storage confined server-side, external I/O
outside short database locks, fresh checks before commit/egress. Browser/design:
existing uploader/display works; no new layout or theme changes were introduced.

- Temporary chunks/orphan originals currently remain private and retained. The
  24-hour expiry prevents finalization, not automatic garbage collection. Monitor
  Storage quota; a separately reviewed cleanup workflow is still needed.
- Actual tested native image is 788,300 bytes; size/pixel boundaries also have
  unit/SQL coverage. Do not claim every maximum-size file or broker/client scenario
  was exercised through a real external AI application.
- Hosted MCP data-flow verification remains behind final authorized activation;
  this rollout installs prerequisites/builds Preview without enabling it.
- File/permanent configuration deletion is **item 3** with one-use browser
  confirmation. Local stdio, requested external-client matrix and final activation
  are still items 4–6. No complete MCP readiness claim or MT5 rebuild.
- Existing developer-tool audit advisories and broader MT5 terminal/VPS/reboot/
  deferred-soak limits are not reported as solved by this increment.
