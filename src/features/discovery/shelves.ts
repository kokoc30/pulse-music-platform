import { AUDIUS_GENRES } from '@/music/audius/genres'

/**
 * The five reference shelves, re-pointed at real Audius operations.
 *
 * Copy is truthful: the reference's "Popular albums and singles", "Popular
 * radio" station names and country charts describe catalogue features Audius
 * does not expose, so each keeps the reference's geometry and gets a label that
 * matches what it actually loads (agents/01_PROJECT_CONTRACT.md → "Legal/Product
 * Truth", agents/05_IMPLEMENTATION_PLAN.md → Phase 8).
 */

export type ShelfId = 'trending' | 'artists' | 'month' | 'stations' | 'charts'

export interface StationShelfItem {
  id: string
  /** Reference tone class, in reference order. */
  tone: 'lavender' | 'pink' | 'rose' | 'amber'
  label: string
  genre: string
}

export interface ChartShelfItem {
  id: string
  /** Reference gradient class, in reference order. */
  className: 'global' | 'usa' | 'top50' | 'top50usa'
  /** Rendered one line per entry, exactly like the reference. */
  titleLines: string[]
  eyebrow: string
  meta: string
  description: string
  source:
    | { kind: 'trending'; time: 'week' | 'month' | 'year' | 'allTime' }
    | { kind: 'underground' }
}

export const STATION_SHELF: StationShelfItem[] = [
  { id: 'electronic', tone: 'lavender', label: 'Electronic', genre: AUDIUS_GENRES.electronic },
  { id: 'hip-hop', tone: 'pink', label: 'Hip-Hop', genre: AUDIUS_GENRES.hipHop },
  { id: 'house', tone: 'rose', label: 'House', genre: AUDIUS_GENRES.house },
  { id: 'lo-fi', tone: 'amber', label: 'Lo-Fi', genre: AUDIUS_GENRES.lofi },
]

export const CHART_SHELF: ChartShelfItem[] = [
  {
    id: 'trending-week',
    className: 'global',
    titleLines: ['Trending', 'This', 'Week'],
    eyebrow: 'AUDIUS',
    meta: 'Updated continuously',
    description: 'The tracks climbing fastest across Audius this week.',
    source: { kind: 'trending', time: 'week' },
  },
  {
    id: 'trending-month',
    className: 'usa',
    titleLines: ['Trending', 'This', 'Month'],
    eyebrow: 'AUDIUS',
    meta: 'Last 30 days',
    description: 'What has held the most attention over the past month.',
    source: { kind: 'trending', time: 'month' },
  },
  {
    id: 'underground',
    className: 'top50',
    titleLines: ['Top 50'],
    eyebrow: 'UNDERGROUND',
    meta: 'Underground trending',
    description: 'Rising tracks from artists outside the mainstream.',
    source: { kind: 'underground' },
  },
  {
    id: 'all-time',
    className: 'top50usa',
    titleLines: ['Top 50'],
    eyebrow: 'ALL TIME',
    meta: 'All-time trending',
    description: 'The most-played tracks across the whole Audius catalogue.',
    source: { kind: 'trending', time: 'allTime' },
  },
]

export const SHELF_TITLES: Record<ShelfId, string> = {
  trending: 'Trending songs',
  artists: 'Popular artists',
  month: 'Popular this month',
  stations: 'Popular radio',
  charts: 'Featured Charts',
}

/** Anchor ids used by the header's utility links and the footer. */
export const SHELF_ANCHORS: Record<ShelfId, string> = {
  trending: 'trending',
  artists: 'artists',
  month: 'this-month',
  stations: 'stations',
  charts: 'charts',
}

/** Cards visible per shelf — the reference renders exactly four. */
export const SHELF_CARD_COUNT = 4
/** Tracks fetched per shelf; the surplus becomes the playback queue. */
export const SHELF_QUEUE_SIZE = 20
