# Pulse Music Home — Design Reference Specification

## Chosen approach: Dark Listening Desk

The supplied reference image is the ground-truth visual specification. The implementation will reproduce its dense desktop browse layout: a compact black utility header, a fixed library rail, a dark content canvas with four-card discovery rows, a compact information footer, and an anchored acquisition banner. The exact Spotify brand mark and wording will be replaced with an original neutral **Pulse** identity, while hierarchy, spacing, color temperature, and component geometry remain reference-led.

**Design Movement.** Contemporary streaming-product UI, rendered as a restrained listening desk rather than a marketing landing page.

**Core Principles.** The page prioritizes content density without visual clutter, makes album art the principal color carrier, uses near-black surfaces to preserve focus, and relies on simple, confidently weighted typography rather than ornamental decoration.

**Color Philosophy.** True black frames the application. A slightly warm charcoal content field separates working areas without conspicuous cards. White signals primary actions; soft gray recedes secondary data. A contained orchid-to-sky spectrum appears only in the lower acquisition strip and selected focus states, preserving a quiet audio-library mood.

**Layout Paradigm.** The page is an application shell rather than a centered site: a top control bar spans the viewport, a vertical library column anchors the left edge, and horizontally flowing music shelves fill the remaining workspace. A slim right rail is retained on wide screens to match the reference’s architectural negative space.

**Signature Elements.** Four-up visual music shelves, perfectly circular artist portraits, and a low fixed spectrum strip distinguish the composition.

**Interaction Philosophy.** Music cards should reveal a restrained play affordance on hover, buttons compress slightly on press, and search presents an inline results layer so the browse experience feels continuous. Interactions should support browsing, never distract from album art.

**Animation.** Card artwork has a 180ms scale and shadow lift; floating play controls fade and rise 6px over 160ms; content shelves enter with a staggered 40ms opacity/translate transition. Reduced-motion preferences remove all nonessential movement.

**Typography System.** Use Manrope for navigational and data text, with slightly more weight and tighter tracking for section headings. Page headings use 700 weight at 26px desktop, titles 500–600 at 15–16px, and supporting metadata 13–14px in muted gray.

**Brand Essence.** Pulse is an original music discovery workspace for listeners who want a direct, focused way to browse songs and artists. **Focused, rhythmic, composed.**

**Brand Voice.** Headlines remain clear and catalog-first; action copy is spare and affirmative. Examples: “Browse what’s moving.” and “Start listening without the friction.” Generic welcome language is excluded.

**Wordmark & Logo.** A compact white disc mark with three nested waveform arcs, paired with the uppercase PULSE wordmark in a geometric, tight letter-spaced treatment. The mark is simple enough to operate at browser-tab scale.

**Signature Brand Color.** **Pulse Orchid — #B64BE7**, used sparingly in the spectrum banner and interactive emphasis.

## Fidelity rules

At a 1080px desktop viewport, the shell should retain the reference’s approximately 64px header and 296px left rail, with the browse canvas beginning around x=296px. Discovery shelves retain four aligned cards per row, section titles with right-aligned “Show all” actions, and a shallow footer beneath a fine divider. The page must collapse responsibly on tablet and mobile without changing the dense, art-led character.
