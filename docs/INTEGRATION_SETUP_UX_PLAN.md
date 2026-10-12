# App-led MT5 and MCP setup

Approved 2026-10-12. Branch: `feature/mcp-access`. Reuse existing services;
do not rebuild MT5, canonical trades, financial arithmetic or the MCP catalog.

## Intended experience

Setup starts at `/settings/integrations`. Users choose Connect MT5 or Connect
AI client, select their account/client, install the Windows companion only where
needed, approve normal OAuth consent, and see verified connection/review state.
Remote MCP requires no MT5 desktop. Windows installation and vendor-client
authorization still require user participation; neither can be silently bypassed.
No broker passwords or AI-provider keys are requested by Trade OS.

## Delivery increments

1. **Owned setup profiles and guided UI:** application-generated public OAuth
   client registration, server-derived callback/resource, account ownership,
   durable registration/recovery, typed credential-free configuration downloads,
   setup/authorization/health states and existing review/control links.
2. **Windows companion distribution:** package existing collector/stdio adapter,
   installation and safe setup-file activation, local configuration and consent,
   dedicated-terminal selection/identity verification, explicit startup controls,
   local health/upload telemetry. No repository, hand-edited JSON or developer
   terminal commands should be required in the finished user experience.
3. **Actual-client acceptance through onboarding:** Codex writes/retries/concurrency/
   revocation, then Claude Code, Gemini CLI and supported remote connector paths.
4. **Operational/release gates:** remaining real-terminal/startup checks, full
   regression/static/build/security verification and approved hosted rollout.

These are separate completion gates, not a claim that increment 1 supplies a
released installer or that configuration generation proves successful connection.
The deferred VPS/extended soak remain separate from this delivery.

## Registration security and recovery

- Setup is managed only by a verified direct browser actor. Database checks remain
  authoritative; no caller-supplied owner, client ID, callback or resource is trusted.
- Each local setup profile receives a distinct public OAuth client. This avoids
  reusing the MT5 grant across accounts or another AI client's credential profile.
- Reserve a durable operation/profile before exactly one external registration
  attempt. Identical retries do not send another create request; changed payloads
  under the same operation ID fail. Concurrent retries cannot become two creators.
- Provider creation cannot be part of a PostgreSQL transaction. Record this boundary
  explicitly: an uncertain response remains REGISTERING. A separate owner-only
  recovery verifies exactly one public provider record with the deterministic
  reserved profile name, exact registered callback and allowed grant types before
  completing the profile transaction/audit. Missing/ambiguous records remain held.
- Reservation/client completion grant **no application access**. Existing S256,
  browser consent, resource binding, grant/revocation/session checks are unchanged.
- Public client provisioning uses a lazy server-only Supabase secret; never return
  provider secrets or raw administrative errors. Bound per-owner profile creation.
- Respect separate setup/integration flags. Disabled/missing prerequisites produce
  an explicit state, not fabricated success or an auth/security fallback.
- Configuration downloads contain public IDs/URLs only, are owner-scoped and
  non-cached, and are not installation/consent/health evidence. New MT5 bootstrap
  files cannot be mistaken for an already mapped collector `connection.json`.
- Remote client setup is not advertised as verified until its actual callback/
  registration path and real-client acceptance pass. No open arbitrary registration.

## Verification

Unit: schemas, URL/callback constraints, owner provenance, missing flags/secret,
single create on retries/concurrency, failed/uncertain registration, constrained
public results and downloads; distinguish permission from observed health.

Database: owner/non-owner/anonymous/OAuth cases, direct-write denial, operation
hash conflicts, quotas, exact provider metadata, ambiguous recovery, immutable
audits and unchanged grants. Use disposable rollback-isolated databases only.

Browser: both themes/mobile, keyboard labels, pending/disabled/unavailable states,
actual provider registration and download, ownership, setup links and public
calculator/login regressions. Installer/native-client gates remain explicit.

At each increment run tests, database suites where schema changes, typecheck,
lint and production build. Hosted migrations/configuration and installer release
need their scoped rollout approval; never implicitly enable production MCP or
resume the collector.
