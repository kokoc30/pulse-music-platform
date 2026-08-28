/** The reference's three animated accent bars marking the current track. */
export function Equalizer({ paused = false }: { paused?: boolean }) {
  return (
    <span className="equalizer" data-paused={paused ? 'true' : 'false'} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}
