# Companion / app-led setup pilot preflight

Date: 2026-10-13. Branch `feature/mcp-access`, source `fe451ba`.
Status: read-only preflight complete; hosted schema rollout requires specific
approval. This report is not an installation, grant, client acceptance or release.

## Verified

- Clean source tree at start. Existing Vercel project is `trade-os`,
  `prj_J06NUbnHQj38DhAK4YX5poGV5ytz`, team
  `team_24dtIFqfL1X7RkcGc6gVif0X`.
- MCP branch deployment `dpl_2adDkvKMiKUhE7oeV2LRabfrF3LG` is READY for
  `fe451bac39fb629f81cc8afda333d8388de7fb51`. The staging alias resolves to it:
  `https://mcp-preview.veilcode.studio`.
- Correct hosted Supabase project is `trade-os`, `nhwlxcrsivmawwmjiwck`, under
  VeilCode Studio. Existing resource bindings remain MCP staging and MT5 production,
  both enabled at the database resource layer. This does not mean production MCP
  is enabled by its application flag.
- Setup/pairing tables are absent. The three existing integration RPCs each have
  exactly the one deliberate `40001` conflict occurrence expected by the reviewed
  setup migration. Storage objects/buckets have RLS.
- Vercel metadata confirms existing server-only sensitive `SUPABASE_SECRET_KEY`
  scoped to `feature/mcp-access` Preview. No values were printed/pulled; no new
  key or provider credential is needed. No setup flag is configured at that scope.
- Private installer remains the checksum-verified local build documented in
  [control verification](MT5_COMPANION_CONTROLS_VERIFICATION.md): 59,171,328 bytes
  (about 56.4 MiB), unsigned, with all native/local verification passed previously.
  Current GitHub repository visibility was verified private using `gh repo view`.
  No public release, repository visibility change or installer upload was made.

## Approval boundary

The approval service rejected both attempted hosted `apply_migration` requests
because generic Proceed was not specific authorization for persistent schema and
security-boundary changes. Neither migration executed. Readback confirms setup
and pairing tables still absent and the three existing conflict codes unchanged.
No workaround/indirect SQL execution was attempted.

Specific proposed scope:

1. Apply the already locally tested
   `20261012145812_integration_setup_profiles.sql` and
   `20261012200515_mt5_companion_pairing.sql` to the existing hosted project.
   These add private owner-bound setup/pairing tables, immutable audits, RPCs and
   grant-binding guards; three existing RPC conflict codes become HTTP 409 rather
   than serialization retries. Existing trade/account data is preserved.
2. Verify schema/ACL/guard readback and security advisors. Enable app-led **MCP
   setup only on the feature-branch Preview**, using its existing server secret
   and exact staging resource. Leave MT5 setup policy disabled initially,
   production MCP disabled and the USD100K DEMO pilot/grants/task unchanged.
3. Redeploy/verify Preview and use the local private installer for user-led
   acceptance. No production promotion, terminal adoption/resume, task registration
   or public installer publication is included in this approval scope.

## Distribution limitation

[Supabase Free file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
cap a single file at 50 MB. The current self-contained installer is larger;
no paid upgrade, higher global setting, multipart bootstrap redesign or public
download repository is assumed. Current project billing/storage configuration
was not retrieved, so this is a Free-plan constraint, not a measured upload rejection.
Local private pilot delivery is available now. In-app hosted installer delivery
needs a separately agreed suitable host/distribution path; the setup UI must not
claim a downloadable installer exists before publication is verified.

## Diagnostic limitations

Connected GitHub metadata returned 404, but the already-authenticated CLI verified
the exact repository and private visibility without exposing credentials. A shell
inline JavaScript quoting attempt failed before execution; a reviewed ignored
helper then successfully reported Vercel metadata only. The unelevated Vercel help
worker hit its cache ACL, while the scoped metadata check succeeded. No cache,
credential, security policy or user data was deleted to bypass these failures.

No application/native source changed, so previous full test evidence is not
claimed newly rerun. Remaining real installer/terminal/startup/client acceptance
and public/operational release gates remain pending.
