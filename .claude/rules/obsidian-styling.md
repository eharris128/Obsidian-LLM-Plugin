---
paths:
  - "src/Plugin/**"
  - "src/Settings/**"
  - "styles.css"
---

# DOM Visibility & Inline Styles (Obsidian-review compliance)

Obsidian's community-plugin review flags styles assigned from JS (themes/snippets can't override them). Keep styling in `styles.css`; use JS only for genuinely dynamic values.

## Show/hide — never `el.style.display`

Toggle visibility with the global **`.llm-hidden`** utility (`styles.css`: `.llm-hidden.llm-hidden.llm-hidden { display: none }` — a specificity boost, **not** `!important`; see [`docs/styling-important-policy.md`](../../docs/styling-important-policy.md)) via Obsidian's `HTMLElement` helpers:

- hide → `el.addClass("llm-hidden")`  ·  show → `el.removeClass("llm-hidden")`
- conditional → `el.toggleClass("llm-hidden", shouldHide)`
- read state → `el.hasClass("llm-hidden")` — **not** `el.style.display === "none"`

The tripled-class specificity boost lets `.llm-hidden` override a base class's own `display` (no other selector in `styles.css` stacks 3+ classes on `display`, so it wins reliably); dropping the repetition reverts to the element's CSS display, so **the element's base class must define its visible `display`** (e.g. `.llm-status-bar-popover`, `.fab-view-area`, `.llm-slash-menu`, `.llm-context-chip-container` all set `display: flex`). Never reintroduce `el.style.display = "…"` or `setAttr("style", "display: …")`.

## Header-managed containers use native `.hide()` / `.show()`

The chat / settings / history containers are toggled by `Header` through Obsidian's `.show()` / `.hide()` (which write inline `display`). Initialize them hidden with `.hide()`, not `setAttr("style","display:none")`. **Do not** mix `.llm-hidden` into these — now that it's a plain specificity boost rather than `!important`, an inline `display` from `.show()` outranks it, so `.llm-hidden` would silently fail to hide them (the mirror image of the old `!important` version, which would instead have defeated `.show()`). Either way the two systems must not be combined on the same element. FAB, StatusBarButton, Widget, and ChatModal2 follow this.

## Inline `el.style.*` only for dynamic values

`el.style.height` / `top` / `left` etc. are acceptable **only** for runtime-computed values with no static CSS equivalent: resize-drag heights (FAB, StatusBarButton), popover positions (`repositionPopover`), the textarea auto-height, and the caret-measurement mirror/ruler. Everything static (colour, spacing, fixed size, display) goes to a `llm-`-prefixed class in `styles.css` using Obsidian CSS vars (`--text-muted`, `--size-4-2`, …) — never hardcoded px/colours. See root `CLAUDE.md` → "Obsidian Core Styling".

ESLint has **no** rule for `.style.*`, so this is convention-enforced: grep `\.style\.display` and `setAttr("style"` before adding visibility logic.

Known remaining exception: the **legacy** in-settings `HistoryContainer` still uses `setAttr("style", …)` for its hover-reveal + edit/save swap (only active when `chatHistoryEnabled` is `false`). Convert it to CSS `:hover` + `.llm-hidden` if you touch that file.
