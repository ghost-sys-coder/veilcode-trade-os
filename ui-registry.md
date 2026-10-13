# Trade OS UI Registry

Visual baseline for the Phase 01 workspace. New interface work should reuse these token-based patterns in both light and dark mode.

### Audited goals and prop forms

Files: `app/(app)/goals/page.tsx`, `app/(app)/prop/page.tsx`, `components/app/mutation-form.tsx`
Last updated: 2026-10-08

Preserve the existing substantial Card surfaces, `grid gap-4`, compact Label,
token Inputs/Buttons and the one-line account/load toolbar in both themes.
Goal edit/archive controls use native disclosures with `mt-5 border-t
border-border/70 pt-4`; archival visibly preserves evidence. Drawdown goals show
limit utilization and within/exceeded status, not achievement for increasing
losses. R summaries show their qualifying sample; missing evidence stays
unavailable. Hidden operation/version fields do not change layout. The shared
native `fieldset.contents` guards hydration and pending writes while preserving
the grid; journal reflections reuse it. Timestamp inputs explicitly say UTC.

### Journal reflection forms and unavailable account register

Files: `app/(app)/journal/{daily,weekly,monthly}/page.tsx`, `app/(app)/accounts/page.tsx`
Last updated: 2026-10-08

Journal hidden operation/version fields do not alter the existing Card, Label,
Textarea and Button styling: `grid gap-4`, `text-muted-foreground`, inherited
`bg-card` and token borders. Preserve the one-line account/period/load toolbar.
Account load failures use the existing alert and neutral em-dash counts, not
fabricated zero accounts or the normal no-accounts empty state. No new tokens.
`features/journal/reflection-form.tsx` uses a native `fieldset.contents` to lock
controls until hydration and during submission, preserving the existing grid.
Do not accept edits while initial default values are still hydrating.

### Application surface

File: `app/globals.css`
Last updated: 2026-09-23

| Property | Class / token |
| --- | --- |
| Background | `bg-background` / `--background` |
| Panel background | `bg-card` / `--card` |
| Sidebar background | `bg-sidebar` / `--sidebar` |
| Border | `border-border/70` |
| Border radius | `rounded-lg` to `rounded-xl` |
| Text — primary | `text-foreground` |
| Text — secondary | `text-muted-foreground` |
| Accent | `text-primary`, `bg-primary` |
| Semantic positive | `text-profit`, `bg-profit` |
| Semantic negative | `text-loss`, `bg-loss` |

**Pattern notes:** Use warm porcelain surfaces in light mode and navy-charcoal surfaces in dark mode. Amber denotes focus and active navigation; teal and coral are reserved for profit and loss semantics.

### Configuration forms: concurrency and archival

Files: `features/strategies/strategy-form.tsx`, `features/strategies/setup-form.tsx`, `features/rules/trading-rule-form.tsx`
Last updated: 2026-10-08

Existing `space-y-4` forms, `space-y-2` field groups, token-based inputs and
`rounded-lg border border-border/70 bg-muted/35 p-4` active-state panels remain
unchanged. Hidden operation IDs and expected versions do not alter the layout.
Archived records use the shared disabled button styling and an explicit
"Archived strategy/setup/rule" label. Archived parents are not offered for new
setups; existing historical parent labels remain visible. No new visual tokens.

### Card

File: `components/ui/card.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | `bg-card` |
| Border | `border border-border/80` |
| Border radius | `rounded-xl` |
| Text — primary | `text-card-foreground` |
| Text — secondary | `text-muted-foreground` |
| Spacing | `gap-5 py-5` with `px-5` regions |
| Hover state | none by default |
| Shadow | `surface-shadow` |
| Accent usage | optional `bg-primary/12 text-primary` icon tile |

**Pattern notes:** Cards are substantial work surfaces, not decorative nested containers. Use a bottom border on the header when the content is a form, table, or register.

### Button

File: `components/ui/button.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | `bg-primary` or `bg-card` |
| Border | `border-transparent` or `border-border` |
| Border radius | `rounded-lg` |
| Text — primary | `text-primary-foreground` |
| Text — secondary | `text-foreground` |
| Spacing | `h-10 gap-2 px-4` |
| Hover state | `hover:-translate-y-px` plus token color shift |
| Shadow | `shadow-sm` |
| Accent usage | primary action only |

**Pattern notes:** Keep primary and outlined actions at a 40px control height. Ghost buttons are reserved for low-emphasis shell actions.

### Page header

File: `components/app/page-header.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | transparent |
| Border | none |
| Border radius | none |
| Text — primary | `text-3xl font-semibold tracking-[-0.035em]` |
| Text — secondary | `text-sm leading-6 text-muted-foreground` |
| Spacing | `gap-5` |
| Hover state | none |
| Shadow | none |
| Accent usage | uppercase amber eyebrow |

**Pattern notes:** Every management page starts with one concise eyebrow, a strong title, supporting copy, and at most one primary action.

### Status badge

File: `components/ui/badge.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | variant token background |
| Border | `border-transparent` |
| Border radius | `rounded-md` |
| Text — primary | variant token foreground |
| Text — secondary | none |
| Spacing | compact horizontal padding |
| Hover state | variant color shift |
| Shadow | none |
| Accent usage | active uses primary; inactive uses secondary |

**Pattern notes:** Status labels are compact, uppercase, and squared enough to feel operational rather than promotional.

### Data form

Account-event/trade workflow update (2026-10-08): hidden operation/version
fields preserve the layout. Required lifecycle reasons use shared Label/Textarea
with existing `space-y-2` spacing. Trading credits use the existing monetary
field pattern and explain trade attribution versus account cash. The explicit
management form (`features/trades/management-form.tsx`) inherits TradeSection,
`grid gap-5`, shared controls, `text-xs text-muted-foreground` help and the
primary Button. Actual stop movements are recorded there, not in a silently
editable post-OPEN field. No new colors, shadows or surface tokens were added.
Broker execution inputs are visibly read-only; opened account/instrument/direction
are locked rather than offering edits the server would reject. Hidden exact
timestamps and change tracking preserve stored fractions on unrelated saves.
Repeated SelectField instances use stable, unique label/control IDs so inline
classification and configuration forms cannot target a different row's control.

Account form update (2026-10-08): hidden operation/version fields preserve the
existing layout. The optional baseline/date correction reason uses the same
`space-y-2` field group, shared Input/Label, and `text-xs text-muted-foreground`
help text. Existing grid spacing, card surface and primary button are unchanged.

Files: `features/accounts/account-form.tsx`, `features/strategies/strategy-form.tsx`, `features/rules/trading-rule-form.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | card surface inherited |
| Border | `border-border/70` for option rows |
| Border radius | `rounded-lg` |
| Text — primary | `text-foreground` |
| Text — secondary | `text-xs text-muted-foreground` |
| Spacing | `space-y-4` or `grid gap-4` |
| Hover state | control primitives own states |
| Shadow | none inside card |
| Accent usage | primary submit action |

**Pattern notes:** Labels are compact and semibold. Inputs, selects, and buttons share a 40px height; explanatory copy sits immediately below the related control.

### Management disclosure

Files: `app/(app)/accounts/page.tsx`, `app/(app)/strategies/page.tsx`, `app/(app)/rules/page.tsx`
Last updated: 2026-09-23

| Property | Class |
| --- | --- |
| Background | `bg-muted/25`, `open:bg-card` |
| Border | `border border-border/70` |
| Border radius | `rounded-lg` |
| Text — primary | `text-sm font-semibold` |
| Text — secondary | `text-xs text-muted-foreground` |
| Spacing | `px-4 py-3`, expanded content `p-4` |
| Hover state | native summary pointer affordance |
| Shadow | none |
| Accent usage | closed-state `text-primary` edit label |

**Pattern notes:** Editors live below scrollable registers so forms cannot be clipped by table overflow. Register links move focus to the corresponding in-flow disclosure.

### Analytics metric tile

File: `features/analytics/metric-tile.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | `bg-card` inherited from Card |
| Border | `border-border/80` inherited; `via-primary/55` top accent |
| Border radius | `rounded-xl` inherited |
| Text — primary | `font-mono text-2xl font-semibold tabular-nums` |
| Text — secondary | `text-xs leading-5 text-muted-foreground` |
| Spacing | `min-h-32 p-5`, value `mt-3`, detail `mt-2` |
| Hover state | none |
| Shadow | `surface-shadow` inherited |
| Accent usage | `text-profit` and `text-loss` only for signed performance values |

**Pattern notes:** Metric values use tabular monospace figures and explicit sample/context copy. Zero and unavailable states stay neutral; semantic profit/loss colors are reserved for signed outcomes.

### Analytics filter panel

File: `features/analytics/analytics-filters.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | `bg-card` |
| Border | `border border-border/70`; footer `border-border/60` |
| Border radius | `rounded-xl` |
| Text — primary | compact semibold Label primitive |
| Text — secondary | `text-xs text-muted-foreground` |
| Spacing | `p-4`, `gap-4`, footer `mt-4 pt-4` |
| Hover state | control primitives own states |
| Shadow | `shadow-sm` |
| Accent usage | primary submit action only |

**Pattern notes:** Dense analytical filters live in one substantial panel, wrap responsively, and always include date-attribution context plus adjacent reset/apply actions.

### Analytics section navigation

File: `features/analytics/analytics-navigation.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | `bg-card`; active `bg-primary` |
| Border | `border border-border/70` |
| Border radius | outer `rounded-xl`, items `rounded-lg` |
| Text — primary | active `text-primary-foreground` |
| Text — secondary | `text-muted-foreground` |
| Spacing | outer `p-1.5`; items `px-4 py-2` |
| Hover state | `hover:bg-muted hover:text-foreground` |
| Shadow | outer and active item `shadow-sm` |
| Accent usage | amber primary fill marks the current analytical view |

**Pattern notes:** Use a horizontally scrollable segmented bar when a data workspace has several peer views. Preserve the active filter query across every destination.

### Performance breakdown table

File: `features/analytics/performance-breakdown-table.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | Card and Table token surfaces |
| Border | header `border-b border-border/70` |
| Border radius | `rounded-xl` inherited from Card |
| Text — primary | `font-medium`; numeric cells `font-mono tabular-nums` |
| Text — secondary | `text-[0.68rem] text-muted-foreground` |
| Spacing | Card header baseline; table content `px-0 pb-0` |
| Hover state | TableRow primitive owns states |
| Shadow | `surface-shadow` inherited |
| Accent usage | none; signed values retain semantic formatting at the metric layer |

**Pattern notes:** Analytical tables always expose counts and qualifying samples alongside rates. Missing or empty populations use an in-table empty state instead of fabricated zero values.

### Performance chart card

Files: `features/analytics/performance-charts.tsx`, `components/ui/chart.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | transparent chart inside `bg-card` parent |
| Border | parent header `border-b border-border/70` |
| Border radius | parent `rounded-xl` |
| Text — primary | CardTitle primitive |
| Text — secondary | `text-sm text-muted-foreground` empty states |
| Spacing | chart `min-h-64`; standard Card regions |
| Hover state | Recharts tooltip uses token surface |
| Shadow | parent `surface-shadow` |
| Accent usage | chart tokens `--chart-*`; drawdown uses `--loss` |

**Pattern notes:** Charts use shared shadcn-style containers, accessible Recharts layers, deterministic axes, and restrained token colors. Render a precise explanatory empty state when the sample cannot support a series.

### Desktop sidebar shell

File: `app/(app)/layout.tsx`
Last updated: 2026-09-24

| Property | Class |
| --- | --- |
| Background | `bg-sidebar` |
| Border | `border-r border-border/80`; footer `border-t border-sidebar-border` |
| Border radius | navigation and account details use `rounded-lg` |
| Text — primary | `text-sidebar-foreground` |
| Text — secondary | `text-muted-foreground` |
| Spacing | brand `h-16 px-6`; navigation `px-3`; footer `p-4` |
| Hover state | navigation `hover:bg-sidebar-accent` |
| Shadow | none on the shell |
| Accent usage | active navigation marker and brand tile use `primary` |

**Pattern notes:** The desktop sidebar has three explicit vertical regions: a fixed brand header, a `min-h-0 flex-1 overflow-y-auto` navigation region, and a `shrink-0` account footer. Only the middle region may scroll, so footer controls remain visible at short viewport heights.

### Integration consent

File: `app/oauth/consent/page.tsx`
Last updated: 2026-10-05

| Property | Class |
| --- | --- |
| Background | `bg-background`; Card inherits `bg-card` |
| Border | header `border-b border-border/70`; notices `border-border/70` or `border-primary/20` |
| Border radius | Card inherits `rounded-xl`; notices `rounded-lg` |
| Text — primary | `text-foreground`; title `text-2xl`; labels `font-semibold` |
| Text — secondary | `text-sm leading-6 text-muted-foreground` |
| Spacing | `space-y-5 pt-5`; notice `p-4`; action `gap-3` |
| Hover state | existing Button primitive; return link `hover:underline` |
| Shadow | Card inherits `surface-shadow` |
| Accent usage | `text-primary`, `bg-primary/5`; disabled approval is not a success state |

**Pattern notes:** Match the existing secure-login surfaces in both themes.
Render client metadata as escaped text, not clickable external links or logo
requests. Approval availability must reflect server-side security readiness;
a disabled control is never the authorization boundary itself.

The account permission selector uses `h-10 rounded-lg border-input bg-background`
with an explicit Label and `focus-visible:ring-ring`. Approval and rejection
share the existing Button primitives; enabled approval is never inferred from
identity scopes or a hidden form field.

### Connected integration clients

File: `app/(app)/settings/integrations/page.tsx`
Last updated: 2026-10-05

| Property | Class |
| --- | --- |
| Background | Card inherits `bg-card`; operational notice `bg-muted/30` |
| Border | header `border-b border-border/70`; notice `border-border/70` |
| Border radius | Card inherits `rounded-xl`; notices `rounded-lg` |
| Text — primary | `font-semibold`; page header primitive |
| Text — secondary | `text-xs text-muted-foreground`; identifiers `font-mono` |
| Spacing | page `space-y-6`; notices `p-4`; register `px-0 pb-0` |
| Hover state | existing TableRow/Button; navigation `hover:underline` |
| Shadow | Card inherits `surface-shadow` |
| Accent usage | `text-primary` icons; active status uses Badge primitive |

**Pattern notes:** Connected-client scope is always visible next to its state.
Use the account's display name, not its UUID, for account scope. Separate
application revocation success from a pending provider-credential retry. Empty
and unavailable states remain distinct; authorization is not terminal health.

### MT5 monitoring and onboarding preview

Files: `features/integrations/mt5-monitor.tsx`, `features/integrations/mt5-forms.tsx`, `app/(app)/settings/integrations/mt5/[connectionId]/page.tsx`
Last updated: 2026-10-05

| Property | Class |
| --- | --- |
| Background | Card `bg-card`; notices `bg-primary/5`; disclosures `bg-muted/25 open:bg-card` |
| Border | headers and disclosures `border-border/70`; pending notice `border-primary/20` |
| Border radius | Card `rounded-xl`; notices/disclosures `rounded-lg` |
| Text — primary | `text-sm font-semibold`; amounts `font-mono tabular-nums` |
| Text — secondary | `text-xs leading-5 text-muted-foreground` |
| Spacing | page `space-y-6`; forms `space-y-4 gap-4`; notices `p-4` |
| Hover state | existing Button/TableRow; links `hover:underline` |
| Shadow | Card inherits `surface-shadow` |
| Accent usage | `text-primary`; stale/unknown states are not profit or success |

**Pattern notes:** Use account display names in selectors, exact broker IDs only
in provenance context. Keep controls in disclosures outside table overflow.
Distinguish source capture, canonical publication and reconciliation. Show
observed equity separately from ledger balance. Do not imply unavailable local
upload counts are zero. Native selects share the 40px control height and token
focus ring; all forms announce pending/result states accessibly.

Publication approval uses the same `space-y-4` form pattern and primary Button.
Selectable execution rows use `rounded-lg border-border/70 bg-muted/25 p-4`,
compact semibold descriptions, muted captions and native `accent-primary`
checkboxes. Baseline acknowledgement is separate from trade selection. No
checkbox defaults to approval; pending submission disables the fieldset.

Volume display update (2026-10-07): execution quantities use `font-mono tabular-nums`.
Presentation uses a shared eight-fractional-digit volume formatter, independent
of account money precision. Rounded displays carry `≈`; the exact captured
quantity remains in the title and accessible label. Tiny nonzero quantities
remain nonzero. No display rounding changes execution, closure, or financial
calculations. Preserve the surrounding Card/Table typography and theme tokens.

### MT5 broker-symbol approval

File: `features/integrations/mt5-symbol-mapping-form.tsx`
Last updated: 2026-10-05

| Property | Class |
| --- | --- |
| Background | parent Card `bg-card`; history `bg-muted/25` |
| Border | controls `border-input`; history `border-border/70` |
| Border radius | controls and history `rounded-lg` |
| Text — primary | labels from Label; history `text-sm font-semibold` |
| Text — secondary | `text-xs leading-5 text-muted-foreground` |
| Spacing | form `space-y-4 gap-4`; history `p-4` |
| Hover state | existing Button; focus `focus-visible:ring-ring/25` |
| Shadow | inherited Card/Button primitives |
| Accent usage | primary approval Button; no profit/success implication |

**Pattern notes:** Native selects use the same 40px height and theme tokens as
account controls. No instrument is pre-approved. Show catalog scope and friendly
instrument names alongside symbols, not UUIDs. Mapping requires a reason;
pending submission disables controls. Current mapping displays its version,
reason and UTC timestamp; immutable decisions remain in private audit history.

### MT5 cash attribution and snapshot onboarding

File: `features/integrations/mt5-cash-onboarding-forms.tsx`
Last updated: 2026-10-05

| Property | Class |
| --- | --- |
| Background | inherited `bg-card`; acknowledgement/history `bg-muted/25` |
| Border | controls `border-input`; acknowledgement/history `border-border/70` |
| Border radius | controls and evidence rows `rounded-lg` |
| Text — primary | Label primitive; evidence `text-sm font-semibold` |
| Text — secondary | `text-xs leading-5 text-muted-foreground` |
| Spacing | forms `space-y-4 gap-4`; acknowledgement/history `p-4` |
| Hover state | Button primitive; focus `focus-visible:ring-ring/25` |
| Shadow | inherited Card/Button primitives |
| Accent usage | `accent-primary`; primary action does not imply trading profit |

**Pattern notes:** Match existing integration controls in both themes. No cash
meaning or performance classification defaults to approval. Show readable
account-adjustment amounts and dates rather than UUID labels. Disable pending
fieldsets, announce failures through alerts, and keep explicit snapshot approval
separate from source publication. Never present stale evidence as reconciled.

### MT5 revision review and publication policy

File: `features/integrations/mt5-review-forms.tsx`
Last updated: 2026-10-07

| Property | Class |
| --- | --- |
| Background | inherited `bg-card`; evidence `bg-muted/25` where used |
| Border | controls `border-input`; sections `border-border/70` |
| Radius | controls and evidence sections `rounded-lg` |
| Text primary | Label primitive; `text-sm font-semibold` |
| Text secondary | `text-xs leading-5 text-muted-foreground` |
| Spacing | `space-y-4`; evidence `p-4` |
| Interaction | Button primitive; `focus-visible:ring-ring/25` |
| Shadow | inherited Card/Button primitives |
| Accent | `text-primary` review links; no profit implication |

**Pattern notes:** Never default a relationship or performance answer. Each
decision needs a reason, identifies the exact revision/trade fingerprint and
announces failure via `role=alert`. Pending inputs are disabled. Prior/current
broker JSON is explicitly expandable, wrapped and scroll-bounded. A withdrawal
of a match decision appends evidence; it does not delete history. Policy,
collection intent and snapshot reconciliation remain visibly separate.

Approval prerequisites appear immediately before the dependent publication card.
A locked control uses `border-border/70 bg-muted/25 p-4 text-sm leading-6` guidance
and a `font-semibold text-primary hover:underline` anchor to the prerequisite.
Disable dependent inputs alongside the button and connect the reason input to
that guidance with `aria-describedby`; do not leave a distant prerequisite as
the only explanation for an inactive action.

### Exact-target deletion consent

File: `app/(app)/settings/integrations/deletions/[requestId]/page.tsx`
Last updated: 2026-10-10

| Property | Class |
| --- | --- |
| Background | inherited `bg-card`; guidance `bg-muted/30` |
| Border | `border-border/70`; failure `border-destructive/25` |
| Radius | guidance/alerts `rounded-lg`; inherited Card radius |
| Primary text | inherited foreground; `text-sm font-semibold` |
| Secondary text | `text-muted-foreground`; identities `font-mono text-xs` |
| Spacing | `space-y-6`, card `space-y-5 pt-5`, guidance `p-4` |
| Interaction | existing Button destructive/outline variants; native keyboard checkbox |
| Shadow | inherited Card/Button primitives |
| Accent | `text-primary` navigation; `accent-primary` checkbox |

**Pattern notes:** Reuse existing warm light/navy dark surfaces. Consent is an
unchecked, required explicit acknowledgement inside MutationForm's hydration/
pending fieldset. Show exact target/version/client/execution ID, original reason,
reference count and UTC expiry. Stale targets visibly disable approval. GET does
not approve or execute. Pending physical deletion is a status with a separate
owner recovery action, never a false success. Wrap long identities/reasons;
390px mobile must not overflow. No new theme tokens or ad hoc colors.

### App-led integration setup

Files: `features/integrations/setup-start.tsx`, `features/integrations/setup-form.tsx`,
`app/(app)/settings/integrations/connect/[purpose]/page.tsx`,
`app/(app)/settings/integrations/setup/[profileId]/page.tsx`
Last updated: 2026-10-12

| Property | Class |
| --- | --- |
| Background | inherited `bg-card`; guidance `bg-muted/30`; unavailable `bg-primary/5` |
| Border | `border-border/70`; controls `border-input`; unavailable `border-primary/20` |
| Radius | controls and guidance `rounded-lg`; inherited Card radius |
| Primary text | inherited foreground; `text-sm font-semibold` |
| Secondary text | `text-sm leading-6 text-muted-foreground`; captions `text-xs leading-5` |
| Spacing | `space-y-6`; form/card `space-y-5 pt-5`; guidance `p-4`; controls `gap-2` |
| Interaction | existing Button variants; links `hover:underline`; `focus-visible:ring-ring/25` |
| Shadow | inherited Card/Button primitives |
| Accent | `text-primary`, `bg-primary/12`; no success/health implication |

**Pattern notes:** Keep the warm light/navy dark language, native labelled
selects and MutationForm hydration/pending fieldset. Account labels use friendly
names plus currency, not UUIDs. Configuration, installation, consent and observed
activity are separate milestones; a saved profile or active grant is never a
health claim. Disabled prerequisites are explained beside the dependent action.
Recover the same registration instead of creating another client. Do not show a
download/install button until the relevant artifact exists and passes its gate.
No new colors, loading animations, theme implementation or external icon assets.

Pairing update (2026-10-13): companion file upload and terminal review use shared
Input/Label/Textarea/Button inside MutationForm, with space-y-4 grouping and
border-border/70 bg-muted/30 p-4 evidence. Display broker server/login, demo mode,
account-currency precision, executable/data folder and UTC observation time before
the unchecked acknowledgement. Disabled consent/mapping prerequisites remain
explicit. File selection never approves mapping; rapid file changes cannot replace
the selected preview with an older asynchronous read. Mapping download is only
available after authoritative approval. No new colors or animations.

Distribution update (2026-10-13): expose a download only when complete verified
preview metadata and setup availability are present. Reuse Button outline,
border-border/70 bg-muted/30 p-4, space-y-3 and muted text. Display unsigned/test
status before the action, version/byte size and a wrapping checksum afterward;
link only to the pinned release repository. A download is not installed,
authorized, online or production-certified. Never advise bypassing OS protections.
Disabled/unconfigured setup retains explicit guidance without a fabricated link.

### Native Windows companion and installer

Files: integrations/companion/native/Companion.cs, integrations/companion/native/Installer.cs
Last updated: 2026-10-12

| Property | Native value / pattern |
| --- | --- |
| Background | navy-charcoal RGB(8,13,20) |
| Text — primary | RGB(239,240,243), Segoe UI; headings bold |
| Text — secondary | RGB(160,177,199) |
| Accent | amber RGB(239,177,37); operational heading/install action |
| Button surface/border | RGB(21,28,39) / RGB(54,64,78) flat border |
| Spacing | 28px body padding; 12–16px vertical rhythm |
| Focus/selection | native keyboard controls and labelled dropdown/text field |
| Shadow / motion | none; native system affordances only |

**Pattern notes:** Native desktop values mirror the web's navy/amber language;
they are not new web tokens. Wrap actions and explanatory copy within the current
viewport and allow vertical scrolling, never clipped horizontal controls. Disable
profile selection and all actions during a request. Reset old verification copy
when switching profiles. Empty, configured, authorized and observed-active states
remain distinct. No generic success badge for imported setup. Installer clearly
states unsigned/private status and that installing files starts no integration.

Pairing update (2026-10-13): dedicated-terminal and same-terminal adoption actions
are MT5-only and require a native explicit confirmation/file choice. Prompt that
SDK connection may launch the selected installation. Copy only the public review
file path; no token is displayed. Approved manifest import explicitly reports
PAUSED and pending uploads, not online/reconciled. Wrapped actions remain vertical
scroll content, and all profile/action controls lock together during the request.

Control update (2026-10-13): local health is text, not a generic green connection
badge. Display saved intent, lock/tick liveness, pending pages and server-contact
freshness separately; missing is unknown, never fabricated zero/online. Label the
8-1000-character multiline reason, fit it to the viewport, disable writes until
meaningful, and clear intent/health on profile changes. All controls are MT5-only.
Read-only refresh/inspection do not require a reason. Start, pause and startup
mutations require an exact-profile native confirmation, explain in-flight pause
and GUI-close behavior, and preserve separate startup/publication approvals.
Unknown acknowledgements direct users to inspect state before retrying. Use the
existing navy/amber flat native controls and vertical scroll; no decorative motion.
