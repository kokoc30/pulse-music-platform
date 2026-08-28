# 22 — YouTube Search and Quota Architecture

## Quota Constraint

Current default allocation:

```text
search.list: 100 calls/day
```

Therefore:
- no YouTube request per keystroke,
- no YouTube autocomplete,
- no automatic alias fanout,
- no automatic pagination,
- no YouTube prefetch on page load.

One explicit fallback action should normally cause one `search.list`.

## Same-Origin Endpoint

Use:

```text
GET /api/youtube?action=search&q=<query>
```

Server calls official YouTube Data API `search.list`.

After verifying current docs, use a narrow music-oriented request similar to:

```text
part=snippet
type=video
q=<literal user query>
maxResults=8
order=relevance
videoEmbeddable=true
videoSyndicated=true
safeSearch=moderate
videoCategoryId=10
key=<SERVER_ONLY>
```

If the live/current API requires another official music category/topic mechanism, use that instead of hardcoding a broken assumption.

## International Queries

Preserve literal Unicode. Do not normalize away Arabic, Armenian, or Cyrillic characters.

Do not automatically issue multiple YouTube searches for aliases/transliterations because quota is scarce.

Optional `relevanceLanguage` only when high-confidence:
- Armenian script may use `hy`,
- Arabic script may use `ar`,
- do not assume all Cyrillic is Russian.

## Batched Enrichment

After `search.list`, collect returned video IDs and issue **one batched `videos.list`** to retrieve required playback/UI metadata such as:
- `contentDetails` duration,
- `status` embeddability/MadeForKids,
- `snippet` where needed.

Do not call `videos.list` once per result.

## MadeForKids

Know `status.madeForKids` before embedding. If compliant MFK embedding cannot be implemented confidently, keep that result external-only (`Open on YouTube`) and do not embed it.

## Normalized YouTube Item

```ts
interface YouTubeVideoItem {
  id: string // youtube:<videoId>
  provider: 'youtube'
  mediaKind: 'youtube-video'
  providerId: string
  videoId: string
  title: string
  channelTitle: string
  thumbnailUrl: string
  durationSeconds?: number
  sourceUrl: string
  embeddable: boolean
  madeForKids: boolean | null
}
```

## HTML Entities

Safely decode metadata entities into text. Never use `dangerouslySetInnerHTML` for YouTube titles.

## Ranking

YouTube is a fallback section, not a combined popularity score. Preserve YouTube relevance order with only light textual sanity checks. Do not combine YouTube statistics with Audius/Jamendo into derived cross-platform engagement metrics.

## Caching

Never cache audiovisual content.

Short-lived metadata caching is acceptable only after verifying current YouTube data-retention policy and Vercel behavior. Prefer:
- client/session exact-query cache,
- optional ~1 hour server/CDN exact-query cache.

No database is needed.

## Quota Errors

Map quota exhaustion to a safe user state such as:

`YouTube search is temporarily unavailable. Try again later.`

Do not retry in loops, scrape YouTube, or rotate projects/keys to bypass quota.
