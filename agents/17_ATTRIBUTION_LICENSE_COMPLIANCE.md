# 17 — Jamendo Attribution and License Compliance

## Why This Is Part of Implementation

Jamendo's API terms require applications to:

- credit Jamendo members as creators,
- credit Jamendo as the provider,
- provide a direct backlink from each Jamendo content item to its relevant Jamendo page,
- use content according to the associated Creative Commons license.

The UI must implement this without redesigning the reference.

## Phase 2 Usage Assumption

This project is treated as a non-commercial portfolio/student application unless explicitly changed later.

Jamendo's API terms state that the API may be used freely for non-commercial uses.

If the project becomes monetized, ad-supported, subscription-based, commercial, or part of a paid product, do not assume the free API terms still apply.

The README must state this caveat.

## Track Attribution

For every Jamendo track shown in a meaningful context, ensure:

1. artist credit,
2. Jamendo provider credit,
3. direct backlink to the Jamendo track page.

Use minimal reference impact.

Example:

```text
Artist Name · Jamendo
```

with `Jamendo` as a small external link.

## Link Behavior

- prefer `shareurl`,
- safe `target="_blank"` with `rel="noopener noreferrer"`,
- accessible name such as `View “Track Title” on Jamendo`.

## License Information

Store `licenseUrl` from `license_ccurl`.

Expose it in an appropriate details/metadata surface where possible without clutter.

## No Downloads

Do not expose `audiodownload` or download buttons.

## Creative Commons Respect

- do not claim ownership,
- do not strip attribution,
- do not remix/transform audio,
- do not offer offline caching,
- retain license metadata.

## No Jamendo Branding Confusion

The app remains its own brand.

Do not imply official endorsement.

## README Compliance Note

Document:

- Audius and Jamendo are external providers,
- catalog availability differs,
- Jamendo tracks retain source/provider attribution,
- Jamendo content is subject to associated licenses,
- this implementation is intended for non-commercial use under currently reviewed Jamendo API terms,
- commercial use requires reviewing current terms/licensing.

## Tests

Add tests ensuring:

- Jamendo normalized tracks have a `sourceUrl`,
- Jamendo rendered tracks expose a backlink,
- Audius tracks do not get Jamendo attribution,
- external links are safe,
- missing `sourceUrl` is handled safely.
