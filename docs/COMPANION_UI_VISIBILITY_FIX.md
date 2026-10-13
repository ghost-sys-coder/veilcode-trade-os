# Companion visibility correction — 2026-10-13

The user's installed preview showed black disabled-button text on navy and a
blank white saved-setup selector. Windows visual styles override disabled native
control colors. The prior loaded-profile/layout tests missed the empty state and
did not assert rendered text contrast.

## Changes

- Shared native button painting keeps disabled labels readable and retains real
  disabled activation, keyboard focus and accessibility behavior.
- The profile selector paints the closed field, dropdown items and focus state.
  Empty/loading states have explicit text; empty setups cannot authorize access.
- Status and next-step guidance appear immediately below the selector.
- MCP profiles hide MT5 collector sections. Selecting MT5 reveals the existing
  controls, with the same authorization, confirmation and reason requirements.
- Import selects the imported profile; labels distinguish client, environment
  and short profile identifier.
- Installer controls share the same theme. Existing profiles and previous
  installations are preserved by the versioned installer.

## Verification

`npm run build:companion` passed with bundled Node 24.21.0 / Python 3.13.16,
960 packaged files and 14 runtime dependencies.

`npm run test:companion-native` passed 15 installation checks and 61 runtime/UI
checks. Includes actual disabled-label and selector pixel checks, empty-state
guidance, disabled click rejection, MCP/MT5 switching, minimum/wide layouts and
larger text. Packaged runtime, IPC, DPAPI, restart and isolated PAUSED-worker tests
also passed. No real broker, grant or startup action was exercised.
`npm run lint` and `git diff --check` passed. Web/database regression suites were
not rerun: this correction changes native controls and their packaging/tests only.

The first new empty-state pixel check failed because owner drawing alone did not
replace the disabled ComboBox closed field. The final implementation handles
native painting/printing; the same check then passed. No assertion was weakened.

Final fixture: `.artifacts/companion/fixtures/feaa0a67-a7f6-4f87-b2c6-0c64043e1cd4`.
Empty, configured Codex, large-text and MT5 screenshots were visually inspected.
The fixture's installed TradeOS.exe hash matches the final build executable:
`589b2399e7414440af07ac9632fb3893627e1626b2a4afce30140dcbb530d7f7`.

Installer: `.artifacts/companion/build-1791873718181-setup.exe`.
Copied without replacing the old download to
`D:\TRADE-OS-INSTALLATIONS\TradeOS-Companion-Windows-x64-ui-fix.exe`.
Readback: 59,183,104 bytes; SHA-256
`19bc950316df85546de84b7b888fb126ecc3c86c7e8c6c3de56168b90ed5c6a8`.
This remains an unsigned acceptance build. Actual installed-user rendering and
browser/client acceptance are pending the user's retry.

## Application download release

The application is the authoritative distribution path. The user explicitly
requested that the corrected build be downloadable through the saved setup page,
rather than delivered as a local-folder workaround.

UI source commit `5325ad5e4a632962904559b488f350683007e559` is pushed to
`feature/mcp-access`. Its public prerelease is
`companion-preview-20261013-5325ad5`, with asset ID `636289430` and the exact size
and checksum above. GitHub upload metadata and a complete anonymous streamed
download both match. It remains a prerelease and is not marked Latest.

Only the branch-specific Preview artifact tag, SHA-256 and byte count were updated,
and each value was read back exactly. Existing setup code constructs the pinned
GitHub download from those validated values. A fresh deployment of the source
commit was requested after the metadata update:
`dpl_Ecnwt6TxnZVmLxmDDicAj5RFjGMG`.
Build logs confirm the full 46-function / 14-column prerequisite check passed.
Deployment is READY; a fresh lookup of `mcp-preview.veilcode.studio` resolves the
exact updated deployment. All five anonymous boundary probes pass. Production's
MCP flag was independently read back as `false`; its endpoint intentionally returns
the same 401 authorization denial as an unauthenticated request. The old diagnostic
helper incorrectly expected a 503/INTEGRATION_DISABLED response; corrected its
expectation against the existing actor-context/error-response implementation.
No production setting was changed.
The saved setup should display the new release tag beside its download button.
The original JSON configuration can be reused.
