import { ChevronLeft } from 'lucide-react'

/** The reference's decorative 40px right rail — architectural negative space. */
export function RightRail() {
  return (
    <aside className="right-rail" aria-hidden="true">
      <ChevronLeft size={21} />
    </aside>
  )
}
