/**
 * The reference's logo is served from a Manus storage proxy that is not
 * available outside that platform (docs/reference-audit.md §1), so the mark is
 * rebuilt as an original SVG from the written spec in refe/ideas.md:
 * "a compact white disc mark with three nested waveform arcs".
 */
export function BrandMark({ title = 'Pulse' }: { title?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} focusable="false">
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <g fill="none" stroke="#0a0a0a" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12.4 11.6a6.2 6.2 0 0 1 0 8.8" />
        <path d="M17.1 8.6a10.6 10.6 0 0 1 0 14.8" />
        <path d="M21.8 6.4a14.6 14.6 0 0 1 0 19.2" />
      </g>
      <circle cx="9.4" cy="16" r="2.5" fill="#0a0a0a" />
    </svg>
  )
}
