# Styling policy: no `!important`

This plugin's `styles.css` contains **zero `!important` declarations**, by policy.
This note records why, and what we use instead, so the decision survives past the
session that made it.

## Why we avoid it

Obsidian's community-plugin review scans each release for `!important` in the
stylesheet and flags it. The reason is a real one, not a formality: a plugin's
`!important` rule can't be overridden by a user's theme or CSS snippet. That
breaks the customization contract Obsidian users expect — the plugin's styling
wins unconditionally, even over the theme the user chose. Keeping the stylesheet
`!important`-free keeps plugin styling *overridable*, and keeps the community
scorecard clean (see
[`docs/plans/2026-07-01-001-fix-obsidian-scorecard-warnings-plan.md`](plans/2026-07-01-001-fix-obsidian-scorecard-warnings-plan.md)
for the wider remediation this came out of).

## What we use instead: specificity boosts

When a rule genuinely needs to win against another rule, we raise its
**specificity** instead of reaching for `!important`. In practice that means
**repeating a class selector** — CSS counts each class in a selector, so
`.x.x` outranks `.x`, and `.x.x.x` outranks both. The element only needs the
class once in the DOM; repeating it in the selector is purely a specificity
lever.

```css
/* Not this: */
.llm-hidden { display: none !important; }

/* This — same element, higher specificity, no !important: */
.llm-hidden.llm-hidden.llm-hidden { display: none; }
```

There are two distinct situations, and they carry different guarantees:

### 1. Hard guarantee — both sides of the override live in our file

When the rule we're overriding is also in `styles.css` (e.g. a base class sets
`display: flex` and `.llm-hidden` must beat it), we control both specificities,
so a boost is a *guaranteed* win. `.llm-hidden.llm-hidden.llm-hidden` is the
canonical case: no other selector in this file combines more than two classes on
a `display` rule, so tripling wins reliably. If a future rule ever stacks 3+
classes on `display`, bump this further.

**Consequence for `.llm-hidden`:** because it no longer carries `!important`, the
element's base class **must define its own visible `display`** (e.g.
`.llm-status-bar-popover`, `.fab-view-area`, `.llm-slash-menu`,
`.llm-context-chip-container` all set `display: flex`). Removing the boost — or
failing to set a base `display` — would silently break show/hide.

### 2. Strong margin — we're overriding Obsidian/theme CSS

When the target is Obsidian's own core/theme styling (e.g. stripping the
background off rendered-markdown elements inside an assistant response, or hiding
the textarea's text behind the caret-mirror), we can't see the other side's
specificity, and themes restyle at varying specificity. Here a doubled class
(`.llm-message-wrapper.llm-message-wrapper …`) is a **strong margin, not a hard
guarantee** — a determined theme could still out-specify us. We accept that trade
deliberately: the failure mode is cosmetic and bounded (e.g. a theme's background
showing through), and it's the price of not using `!important`. Each such site in
`styles.css` carries a comment naming the trade-off and its failure mode.

## Enforcement

- **`npm run lint:css`** (`scripts/check-no-important.mjs`) fails if any
  `!important` declaration appears in `styles.css`. It strips `/* comments */`
  first, so the explanatory notes above (which *mention* `!important`) don't trip
  it — only real declarations fail.
- **CI** (`.github/workflows/ci.yml`) runs `lint:css` and a `tsc` type-check
  (`npm run typecheck`) on every push to `main` and every PR, so a stray
  `!important` or a type error fails before a release is cut. The scorecard only
  rescans releases, so catching it pre-release is the point.

## Related references

- [`.claude/rules/obsidian-styling.md`](../.claude/rules/obsidian-styling.md) —
  the day-to-day DOM-visibility / inline-style rules (auto-loads when styling
  files are read).
- Inline comments in `styles.css` at each specificity-boosted rule explain that
  site's specific trade-off.
- Root `CLAUDE.md` → "Obsidian Core Styling" — the broader native-before-custom
  convention.
