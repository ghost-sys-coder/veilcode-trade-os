# MCP controlled private-file increment

2026-10-09. Branch `feature/mcp-access`, baseline `a30c5f3`.
Item 2 of the completion checklist only. Architecture and server-only Storage
access confirmed by the user. Implementation and local verification are complete;
the separately approved hosted prerequisites and branch-only Preview secret are
installed after the final regression checks. No master merge or hosted MCP activation.

## Existing implementation and agreed language

- Private files are screenshot evidence attached to owned canonical trades,
  not arbitrary local files, external URL ingestion or a separate file model.
- Preserve existing category, timeframe, caption and captured-at metadata.
  The private bucket accepts PNG/JPEG/WebP, up to 10,485,760 bytes (10 MiB).
- Upload request reserves an exact server-generated object identity; reservation
  is not proof that verified image evidence exists.
- Upload finish validates stored content and atomically commits metadata,
  operation receipt and mutation audit. Unverified bytes are not published.
- Download is bounded authenticated retrieval of an exact owned attachment,
  not a public URL or a capability that survives application revocation.

The existing browser uploader uses that bucket and metadata relation. OAuth
isolation deliberately denies integrations direct workspace and Storage access.
Browser Supabase configuration continues to use only a publishable key. The user
added the server-only secret directly to `.env`; no values are printed or committed.

## Confirmed security decision

Keep direct OAuth table/Storage access denied. Use server-mediated Storage calls
only after verified application authorization and fresh ownership, grant,
intent/version and expiry checks. These calls require a server-only
`SUPABASE_SECRET_KEY`, which must never reach browsers, clients, logs or Git.
This is infrastructure access, not an AI-provider key. Do not retrieve/create
the key or change hosted configuration without approval.

Supabase signed upload URLs work without further authentication for two hours.
Use authenticated application transfer endpoints instead, rechecking access on
every request. Do not weaken revocation by distributing native signed file URLs.

## Implemented architecture

1. Add strict schemas, central type/size/content/hash validation, paginated owned
   metadata reads and exact-object upload intent/status models.
2. Add private reservation/finalization workflows with existing verified actors,
   operation receipts, optimistic versions and atomic audits. No arbitrary owner,
   storage path or client-submitted calculated validation result.
3. Add a fixed-bucket server-only Storage adapter. Keep external I/O outside short
   database transactions; revalidate before commit. Preserve resumable intent for
   uncertain uploads and lost acknowledgements.
4. Transfer through authenticated `/mcp` chunk tools, not signed upload URLs or
   a second public binary endpoint. Retain the 10 MiB file limit and 393,216-byte
   chunks beneath the 1 MiB MCP request cap. Decode complete single-frame images
   within 16,000,000 pixels; do not trust extensions or claimed MIME/hash alone.
5. Add MCP metadata/list, upload-request/status, upload-finish and download tools
   plus resource guidance. Update counts from actual registered tools.
6. Test owner/non-owner/anonymous/MT5 roles, forged contexts, expiry/revocation,
   malformed/oversized content, traversal, overwrite, stale versions, retries,
   concurrency and atomic audit rollback.
7. Run unit/database/typecheck/lint/build, real local OAuth/SDK and browser flows,
   plus MT5 regression checks. Report exact commands, versions and limitations.

## Release boundary and current prerequisites

Preserve browser uploads, historical attachments, financial records and MT5
control state. No arbitrary SQL, shell, local-path or external-URL access, public
bucket, broker execution or AI-provider calls. Permanent deletion remains item 3
behind one-use browser confirmation. Do not merge master or enable hosted MCP.

Docker and disposable local Supabase are available. The real OAuth/official SDK/
Storage/browser flow now passes, including full-size chunks, concurrent retries,
audit rollback, original recovery, legacy uploads and revocation. Hosted approval
covers this migration and sensitive Preview configuration only on
`feature/mcp-access`. See [verification and limits](MCP_PRIVATE_FILES_VERIFICATION.md).

Private staging is not evidence. Duplicate chunks require stored size/type/hash
checks in the atomic database writer; finalization reads/hashes/decodes actual
bytes. Existing originals are read and verified before another no-overwrite POST.
Native HTTP uses explicit lengths, no redirects, independent sockets and bounded
responses/deadlines. Expired reservations cannot finish. Temporary bytes currently
remain private and retained; expiry is not automatic garbage collection. Monitor
Storage quota until a separately reviewed cleanup workflow is supplied.

## Primary references

- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Signed uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads#presigned-uploads)
- [Server-only secret keys](https://supabase.com/docs/guides/getting-started/api-keys)
- Installed Next.js 16.3.8 Route Handler guide and complete `route.js` reference
  under `node_modules/next/dist/docs/01-app/` were read before implementation.
