---
name: Support portal theming / re-brand
description: How to re-color the support portal + mobile app to a brand palette; why a token swap alone is not enough.
---

# Re-theming the support portal

The single source of truth for tokens is `artifacts/support-portal/src/index.css`
(Tailwind v4 `@theme inline` + HSL tokens in `:root`/`.dark`). But swapping those
tokens ALONE does not re-brand the app.

**Why:** the portal pages carry 100+ *hardcoded* colors — arbitrary hexes
(`#0F1F3D`, `#2563EB`, `#1d4ed8`) and cool palette utility classes
(`slate-*`, `gray-*`, `blue-*`, `indigo-*`). A real re-color must sweep these too.

**How to apply (mechanical recolor that preserves layout):**
- Update `index.css` `:root` + `.dark` token blocks.
- Sweep utility classes across `src/**/*.tsx` (color utilities only — match a
  `-<color>-` with a hyphen before it so you never touch `translate-`):
  cool neutrals `slate`/`gray` → warm `stone`; `blue`/`indigo` → `amber`.
- Sweep hardcoded hexes with judgment by CSS context: a brand color used as
  background/fill/border/icon vs. as readable text needs different targets.
- Mirror the result into `artifacts/mobile/constants/colors.ts` (hex, both
  light+dark objects) — mobile does not read the CSS tokens.
- A blind `sed` that isn't context-aware corrupts quotes/colons in TSX; use a
  lookbehind/perl regex or a subagent that verifies afterward.

**Current Ekai brand (as of the 2026 re-brand):**
- Primary = gold `#EFB323` (hover `#D69E1E`).
- Navy `#0F1F3D` is the FOREGROUND/text color and stays everywhere.
- Warm cream backgrounds, `stone` neutrals, warm-tan borders.

**Contrast rule (bit us in review):** gold `#EFB323` / `amber-400/500` are LIGHT —
white text on them FAILS contrast. Use navy `text-[#0F1F3D]` (or the
`primary-foreground` token, which now resolves to navy) on gold buttons. Amber
used as readable TEXT on light surfaces must be `amber-700/800`; amber-500/600 is
fine only for icons. Verify no `text-white` remains on any amber/gold background.
