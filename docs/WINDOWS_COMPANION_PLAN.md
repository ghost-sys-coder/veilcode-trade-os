# Windows companion — app-led setup increment 2

Approved setup contract: [INTEGRATION_SETUP_UX_PLAN.md](INTEGRATION_SETUP_UX_PLAN.md).
Reuse the delivered MT5 coordinator, OAuth/DPAPI vault, startup controls and MCP
stdio adapter; do not duplicate financial/domain services or broker execution.

Current checkpoint: packaging, protected import, consent, reviewed-terminal
pairing/PAUSED activation, local running/pause/recovery controls, startup opt-in
and local telemetry are implemented. Artifact/hosted rollout and real-user
acceptance remain pending; implementation is not a public release.
See [verification](WINDOWS_COMPANION_VERIFICATION.md).
See [pairing verification](MT5_COMPANION_PAIRING_VERIFICATION.md) for the next checkpoint.
See [control verification](MT5_COMPANION_CONTROLS_VERIFICATION.md) for the current checkpoint.

## Delivery

1. Self-contained Windows x64 distribution and per-user native GUI/installer,
   with pinned supported Node and CPython 3.13 embedded runtimes and native wheels.
   Build with the available Windows Framework compiler; no new global SDK install.
   Hash-verify every downloaded input and packaged file; include dependency/runtime
   licenses. No Git checkout, npm, pip or model API key is needed by the user.
2. Strict public setup import into protected, isolated local profiles. Opening a
   file creates configuration only, never a grant, task, collector or trade. MCP
   consent/verification delegates to the packaged existing adapter. Provide exact
   native launcher configuration without overwriting unrelated vendor settings.
3. MT5 consent, explicitly approved dedicated-terminal identity probe, browser
   mapping handoff, mapped-manifest import and PAUSED initialization. Browser
   ownership/grant/identity checks remain authoritative. Never inspect another
   terminal, select a saved account or create a fabricated mapping/plan.
4. Explicit bounded controls and health/pending-upload reporting. Startup is a
   separate opt-in; do not install tasks or resume the existing pilot in this build.
   Installation/upgrades preserve all user profiles, vaults, spools and audits.
5. Disposable native installation/profile/GUI/protocol/security tests, existing
   Python and application regressions, static checks and build. Then request the
   separate hosted/artifact-release approval. Signed/public distribution and real
   external-client acceptance are not inferred from a locally compiled executable.

## Boundaries

- Windows 10/11 x64 with Framework 4.8; one per-user install, selectable local
  location (including D:), no administrator/SYSTEM/boot task requirement.
- Native GUI, no public local HTTP server, arbitrary shell/SQL, password capture,
  plaintext token export, browser-CSRF bridge or open custom URL dispatcher.
- Bootstrap pins trusted Trade OS application/issuer endpoints. Production files
  cannot opt into insecure HTTP; disposable test trust is injected only in tests.
- The caller selects a local setup file. Bounds, duplicate JSON keys, credential
  fields, remote/relative/junction paths, retargeting and changed-profile overwrite
  are rejected. Atomic protected writes preserve existing data on failure.
- Native child commands are fixed. Only bundled runtimes are used; environment
  injection and global PATH dependencies must not control execution. Existing
  account-bound vault/worker locking and bounded supervision are preserved.
- Broker identity is a local observation, not permission or proof of reconciliation.
  The collector re-verifies it before every read; it starts only with a server
  mapping and explicit operator intent. Unattended publication remains separate.
- Test artifacts are unsigned and are not published by building or pushing source.
  Do not disable Windows security, buy a signing certificate or change policies.
- Existing hosted settings, grants, Windows tasks, manually operated/Claude-connected
  terminals and the paused USD100K pilot remain untouched without scoped approval.

Sources: [Python embedding](https://docs.python.org/3.13/using/windows.html#the-embeddable-package),
[C# Framework compiler](https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-options/),
[native GUI output](https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-options/output).
