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

File: `components/ui/card/card.tsx`
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
