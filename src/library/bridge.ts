import { setExplicitIntentSource } from '@/personalization/explicit-intent'
import { usePersonalizationStore } from '@/personalization/store'
import { libraryExplicitIntent } from './hooks'
import { libraryState, onLibraryChange } from './store'

/**
 * Connects the library to the preference profile.
 *
 * The whole coupling between the two domains is these few lines, and the arrow
 * points one way. The library hands personalization a *reader*; personalization
 * calls it while it is enabled and ignores it otherwise. Neither store imports
 * the other's state, so consent stays enforced in exactly one place and a test
 * can exercise either domain alone (agents/43 → "Do not create a second profile
 * engine"; agents/41 → "Separate library from personalization").
 *
 * Recomputing on change is what makes a heart click move the home page: the
 * profile's inputs changed even though nothing in personalization storage did.
 */
export function connectLibraryToPersonalization(): () => void {
  setExplicitIntentSource(() => libraryExplicitIntent(libraryState()))
  usePersonalizationStore.getState().refreshProfile()

  const unsubscribe = onLibraryChange(() => {
    usePersonalizationStore.getState().refreshProfile()
  })

  return () => {
    unsubscribe()
    setExplicitIntentSource(null)
  }
}
