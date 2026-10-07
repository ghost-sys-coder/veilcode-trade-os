# MCP initial HTTP foundation

Date: 2026-10-08. Branch: `feature/mcp-access`.
Status: initial foundation, not MCP feature completion or hosted activation.

## Implemented

- Official stable SDK `@modelcontextprotocol/server` / `client` 2.3.1, compatible
  with Node >=20 and the deployed Node 24 runtime. Current SDK documentation and
  installed type declarations were checked before implementation.
- Per-request stateless HTTP at `/mcp`; no session map or desktop dependency.
  MCP requests skip cookie-session proxy handling and use signature/live-grant
  verification with the exact MCP resource. Wrong hosts/origins are rejected.
- Public protected-resource metadata at
  `/.well-known/oauth-protected-resource/mcp`; MCP-specific OAuth challenge.
- Five contract resources: catalog, domain relationships/enums, money,
  workflows and reporting. The catalog explicitly labels unimplemented families.
- Structured capability discovery, shared decimal position sizing and authorized
  durable operation-status lookup. Every HTTP request verifies its actor;
  operation reads retain the existing private database authorization.
- Request body bound of 1 MiB, no-store responses, stable redacted errors,
  authenticated GET/DELETE returning 405, and no persistent subscription streams.

## Focused protocol evidence

Eight tests use the official SDK client/handler, including legacy and pinned
2026-07-28 protocol exchange. They cover discovery/contracts, structured results,
fresh-request authorization, immediate rejection on revoked authentication,
wrong host/origin, transient-provider failure, stateless methods and secret
redaction. Hand calculation: USD100000 at 1% risk = USD1000; EURUSD entry1.10000
and stop1.09800, contract100000 -> USD200 loss/lot -> 5.00 lots. Numeric money
inputs are rejected; account-currency precision is explicit.

Regression commands: `npm test` passed 493 tests / 39 files, including the eight
protocol tests. `npm run typecheck`, `npm run lint` and `npm run build` passed;
the build includes 32 generated pages and the new MCP/discovery routes. Existing
database/Python behavior is unchanged; their latest recorded results remain
501 database assertions (with the documented local image hint workaround) and
176 Python tests. This checkpoint adds no database migration or broker operation.
`npm run test:integration-browser` also passed all 53 existing real local
browser/provider/API regressions after the shared HTTP boundary and dependency
updates. Actual MCP provider consent, database workflows and external client
applications are still separate pending gates.

## Dependencies

Compatible updates patched transitive SDK1.30.0, sharp0.35.4 and source-map-js1.2.1
audit findings. `npm audit --omit=dev --json` reports zero production findings.
The full development-tool audit retains eight high notices rooted in the
unpatched braces3.0.3 glob dependency (Next lint tooling and shadcn/ts-morph).
The registry's latest braces release is still3.0.3; no framework downgrade or
unreviewed third-party fork was introduced. This remains an explicit dependency
limitation, not a clean full-audit claim.

## Remaining release gates

Typed shared CRUD/services, immutable mutation receipts/audits and versions,
archive/deletion approval, private screenshots, complete capability families,
local stdio renewable credentials, actual MCP OAuth compatibility and the
requested real-client matrix remain pending. Hosted MCP flag/resource stay off.
No model-provider credentials or model calls are used.

References: [official SDK HTTP factory](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/serving/http.md),
[authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
