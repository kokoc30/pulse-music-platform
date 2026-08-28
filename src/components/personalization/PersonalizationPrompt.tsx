import { Link } from 'react-router-dom'
import { usePersonalizationStore } from '@/personalization/store'

/**
 * The one-time, on-device personalization choice.
 *
 * Deliberately not a modal and deliberately not a dark pattern. Both answers are
 * ordinary buttons of equal weight, *Not now* is not hidden or greyed, nothing
 * is pre-selected, and the app is fully usable whichever is pressed — declining
 * costs the visitor no feature except personalization itself (STEP 17).
 *
 * It appears only when there is a real choice to make: storage works, and the
 * question has not been answered before. A refusal is remembered, so the strip
 * does not return on the next visit.
 *
 * The copy states the two facts that actually matter and no more: where the data
 * lives, and that it can be cleared. Nothing here implies an account, a server
 * profile or synchronization, because none of those exists.
 */
export function PersonalizationPrompt() {
  const consent = usePersonalizationStore((store) => store.state.consent)
  const hydrated = usePersonalizationStore((store) => store.hydrated)
  const storageAvailable = usePersonalizationStore((store) => store.storageAvailable)
  const setConsent = usePersonalizationStore((store) => store.setConsent)

  // Asking a browser that cannot store the answer would be a question with no
  // effect, so it is not asked.
  if (!hydrated || !storageAvailable || consent !== 'unset') return null

  return (
    <section
      className="personalization-prompt"
      aria-labelledby="personalization-prompt-title"
      data-testid="personalization-prompt"
    >
      <div>
        <b id="personalization-prompt-title">Personalise your home page?</b>
        <span>
          Pulse can remember what you play and search for on this device to suggest music. It stays
          in this browser, is never uploaded, and you can clear it at any time in{' '}
          <Link to="/settings">Settings</Link>.
        </span>
      </div>
      <div className="personalization-prompt-actions">
        <button type="button" className="ghost-button" onClick={() => setConsent('denied')}>
          Not now
        </button>
        <button type="button" onClick={() => setConsent('granted')}>
          Enable
        </button>
      </div>
    </section>
  )
}
