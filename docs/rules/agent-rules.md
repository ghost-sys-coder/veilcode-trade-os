Use Next.js App Router.

Use React and strict TypeScript.

Use Tailwind CSS.

Use shadcn/ui whenever an appropriate component exists.

Do not manually recreate a standard component that shadcn provides.

Use no more than one React component per file.

Do not define local helper React components inside another component file.

Keep business logic out of React components.

Keep financial calculations in deterministic domain/service functions.

Use Supabase PostgreSQL.

Use Supabase Storage for screenshots.

Use Zod for form and API validation.

Use migrations for database changes.

Use foreign keys and appropriate indexes.

Do not expose Supabase service credentials or other secrets client side.

Prefer Server Components unless client interaction requires a Client Component.

Keep Client Components as small as reasonably possible.

Do not use `any` unless technically unavoidable and explain why.

Do not hardcode analytics.

All trading statistics must derive from persisted data.

Do not calculate important financial metrics only inside UI components.

Unit test all important financial calculations.

Do not implement broker integrations during the manual logging phases.

Do not add unrelated SaaS functionality.

Do not add billing.

Do not add social features.

Do not overengineer.

Inspect existing code before changing architecture.

Reuse good existing code.

Do not stop at scaffolding.

A phase is complete only when its functionality actually works.

At the end of every phase run:
typecheck
lint
tests
production build

Fix regressions introduced by the phase before stopping.