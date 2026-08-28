# 08 — UI Fidelity Rules

## Definition of "Exactly as Reference"

"Exactly" does not mean copying mock data.

It means the production app should preserve the reference's:
- composition,
- hierarchy,
- geometry,
- visual language,
- interaction presentation,
- responsive behavior,
while real data replaces mock content.

---

## Fidelity Priority

### Level A — Must match

- page layout,
- sidebar/mobile navigation,
- header/search placement,
- persistent player dimensions/placement,
- grid/list structure,
- major spacing,
- content widths,
- responsive breakpoint behavior,
- brand/logo presentation,
- typography family if available/licensable,
- core color palette.

### Level B — Match closely

- radius,
- border,
- shadow,
- hover surfaces,
- progress bar,
- button dimensions,
- card proportions,
- artwork crop,
- icon size/stroke,
- overlays.

### Level C — Approximation allowed only if necessary

- subtle animation timing,
- browser-specific blur,
- antialiasing differences,
- exact cross-platform font metrics,
- tiny one-pixel deviations.

Do not use Level C as an excuse for Level A mismatch.

---

## Design Tokens

Extract actual tokens from reference before writing production styles.

Create a token layer rather than scattering magic values.

Possible form:

```css
:root {
  --color-bg: ...;
  --color-surface: ...;
  --color-text: ...;
  --color-muted: ...;
  --color-accent: ...;

  --radius-sm: ...;
  --radius-md: ...;
  --radius-lg: ...;

  --sidebar-width: ...;
  --player-height: ...;
}
```

Names may differ based on reference.

---

## Typography

Do not substitute fonts casually.

If reference uses a web font:
- determine how it is loaded,
- use the same legal source if available.

If a proprietary/local font cannot be shipped:
- use the closest defined fallback,
- document the deviation.

Match:
- line-height,
- letter spacing,
- weight,
- casing,
- truncation.

---

## Artwork

Real Audius artwork changes visual composition compared with reference mock art. That is expected.

Preserve:
- dimensions,
- border radius,
- object fit,
- overlays,
- hover behavior.

Do not color-correct provider artwork to force it to resemble mock covers.

---

## Icons

Prefer the exact icon library found in reference.

If reference uses custom SVG:
- reuse the user's asset if appropriate.

Do not mix 3 icon libraries.

---

## Search Result Data Density

Match reference:
- row height,
- displayed metadata,
- mobile simplification,
- hover action placement.

Do not turn a refined track list into a generic data table.

---

## Responsive Rules

Determine reference breakpoints empirically/code-first.

At each breakpoint verify:
- sidebar visibility,
- header layout,
- content padding,
- grid columns,
- table columns,
- track truncation,
- player controls,
- queue presentation,
- mobile nav,
- expanded player.

Do not merely set `overflow-x: auto` to hide a bad mobile layout.

---

## Interaction States

Implement all reference-relevant states:

- default,
- hover,
- active,
- focus-visible,
- disabled,
- loading,
- playing,
- paused,
- selected.

No control should visually react but do nothing.

If a mock control has no V1 function:
- either wire a truthful action,
- or remove/disable it in a way that minimally impacts reference fidelity.

Document significant changes.

---

## Motion

Reuse reference timing/easing where discoverable.

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

Do not add decorative animation unrelated to reference.

---

## Screenshot QA

Use Playwright to capture production screenshots at the same viewport as reference screenshots.

Keep QA captures under:

`test-results/` or an ignored local directory.

The reference audit screenshots under `docs/reference-screenshots/` may be committed when useful.

---

## Visual Review Checklist

For each main state ask:

- Is the app frame the same size?
- Is content starting at the same x/y position?
- Is the player the same height?
- Are typography scale and weight comparable?
- Is the search control the same height/width?
- Are artwork sizes correct?
- Are cards/rows using the same density?
- Are desktop/mobile navigation transitions correct?
- Is currently-playing styling correct?
- Are empty/loading/error states consistent?
