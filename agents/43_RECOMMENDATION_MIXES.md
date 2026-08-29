# Recommendations upgraded by explicit library intent

## Goal

Phase 4 already learns from listening/search behavior and Phase 6 has similar-track autoplay.

Phase 7 should make recommendations feel more intentional by incorporating **explicit user actions**:

- Like
- Add to playlist
- Hide / Not interested

Do not create a second profile engine.

Extend the existing personalization scoring carefully.

## Signal hierarchy

Conceptual signal strength:

```text
qualified listen             positive
repeat qualified listen      stronger
high completion              strong
Pulse Like                   very strong explicit positive
add to playlist              strong explicit positive
remove like                  remove explicit-like contribution, not necessarily a negative
Not interested               strong negative/exclusion
early skip                   weak negative
```

Do not hardcode these exact words/numbers into UI.

Keep weights centralized and deterministic.

## No double-count explosions

A track appearing in five playlists must not produce five times the preference weight.

Use bounded explicit-intent contribution.

A reasonable model:

```text
liked?               one strong signal
in >=1 playlist?     one additional bounded signal
playlist count       capped or ignored beyond first
```

## "Not interested"

Add a local action on recommendation surfaces:

```text
Not interested
```

Behavior:

- hide that exact item from generated recommendation shelves
- add a negative/exclusion signal to the local profile if personalization consent is granted
- do not affect provider accounts
- do not delete history
- allow undo from toast
- Settings may expose "Reset hidden recommendations"

Do not infer sensitive attributes from this action.

## Made-for-you mixes

Create dynamic virtual mixes, not persisted playlists by default.

Suggested sections:

```text
Your Mix
Discovery Mix
More from your likes
```

or, if strong clusters exist:

```text
Your Mix 1
Your Mix 2
Your Mix 3
```

Do not use Spotify trademarked presentation/copy.

## Mix construction

Use Audius/Jamendo only for generated recommendation scoring.

Input signals:

- existing local preference profile
- liked Audius/Jamendo tracks
- playlisted Audius/Jamendo tracks
- recent qualified listens
- provider genres/tags/mood/BPM where available
- Jamendo `/tracks/similar`
- existing Audius discovery/session candidates
- Phase 6 autoplay scorer where reusable

Do not create a parallel recommendation algorithm if the Phase 6 similarity scorer can be composed.

## Cluster strategy

Build 1–3 deterministic clusters from strongest available non-sensitive music signals:

Examples:
- artist affinity
- genre/tag affinity
- mood
- script/search affinity
- tempo neighborhood

Never label a cluster as user ethnicity/nationality/religion.

Good labels:
```text
More like your recent Arabic-script searches
More from artists you like
A high-energy mix
```

Prefer generic product names if the evidence is weak.

## Candidate composition

Per mix:
- target 15–30 tracks
- max 2 tracks per artist
- avoid current explicit queue duplicates
- suppress recently overplayed items
- exclude hidden/not-interested items
- approximately 75–85% affinity
- approximately 15–25% exploration

Exact ratios may adapt.

## Save a mix

Add:

```text
Save as playlist
```

This snapshots the current mix into a normal local playlist.

After saving, it no longer automatically changes.

## Regeneration

Virtual mixes may update when:
- explicit likes change
- playlist additions change
- a meaningful listen qualifies
- profile changes substantially

Do not regenerate every playback second.

Use deterministic memoization/cache invalidation.

## Cold start

If there is not enough profile/library evidence:
- do not show fake "Made for you"
- keep discovery/trending fallback
- maybe show "Start liking songs to personalize this mix"

## YouTube

YouTube API metadata must remain excluded from cross-provider derived recommendation scoring.

A Pulse user action on a YouTube item may be stored only within the policy-safe temporary-library rules in `44_PROVIDER_POLICY_BOUNDARIES.md`.

Do not derive genre/style/user preference from YouTube API metadata.
