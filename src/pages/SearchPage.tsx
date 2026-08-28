import { useEffect } from 'react'
import { Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SearchResults } from '@/features/search/SearchResults'
import { useTrackSearch } from '@/features/search/useTrackSearch'
import { normalizeQuery } from '@/music/audius/adapter'

export function SearchPage() {
  const [searchParams] = useSearchParams()
  const query = normalizeQuery(searchParams.get('q') ?? '')
  const search = useTrackSearch(query)

  useEffect(() => {
    document.title = query ? `${query} — Pulse` : 'Search — Pulse'
    return () => {
      document.title = 'Pulse — Music Discovery'
    }
  }, [query])

  // A bare /search with no query is a valid deep link; show the reference's
  // empty state rather than firing a pointless request.
  if (!query) {
    return (
      <section className="search-results">
        <div className="result-title-row">
          <div>
            <p className="eyebrow">Search results</p>
            <h1>Search Pulse</h1>
          </div>
        </div>
        <EmptyState
          icon={<Search size={32} aria-hidden="true" />}
          title="Start typing to search"
          description="Search the Audius catalogue by song title, artist or genre."
        />
      </section>
    )
  }

  return <SearchResults query={query} search={search} />
}
