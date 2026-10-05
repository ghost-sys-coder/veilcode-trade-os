# Trade OS UI Registry

Visual baseline for the Phase 01 workspace. New interface work should reuse these token-based patterns in both light and dark mode.

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
