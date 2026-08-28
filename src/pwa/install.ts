/**
 * Install support, as progressive enhancement.
 *
 * Chromium fires `beforeinstallprompt`, which can be captured and replayed from
 * a real user gesture later; Safari fires nothing and offers no API at all, so
 * iOS gets written instructions and only after the visitor asks for them
 * (agents/31 → "iOS: only show Add to Home Screen instructions after explicit
 * user interest").
 *
 * Nothing here nags: there is no banner, no interstitial and no automatic
 * prompt. The control lives in Settings and is pressed on purpose.
 */

/** The Chromium-only event. Not in the DOM lib, so it is described here. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<(available: boolean) => void>()

function announce(): void {
  for (const listener of listeners) listener(deferred !== null)
}

/**
 * Starts listening for the browser's install offer.
 *
 * Called once at start-up. The default `beforeinstallprompt` behaviour — a
 * browser-chrome prompt — is suppressed so the offer can be made in context,
 * from Settings, instead of over the page.
 */
export function watchInstallAvailability(target: EventTarget = window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    announce()
  }
  const onInstalled = () => {
    deferred = null
    announce()
  }

  target.addEventListener('beforeinstallprompt', onPrompt)
  target.addEventListener('appinstalled', onInstalled)
  return () => {
    target.removeEventListener('beforeinstallprompt', onPrompt)
    target.removeEventListener('appinstalled', onInstalled)
  }
}

export function isInstallAvailable(): boolean {
  return deferred !== null
}

export function onInstallAvailabilityChange(listener: (available: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Shows the browser's own install dialog.
 *
 * The captured event can only be used once, so it is released either way —
 * a dismissed prompt is not an error, and the browser will offer another when
 * it decides the visitor is engaged enough.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  announce()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return 'dismissed'
  }
}

/** True when the app is already running installed rather than in a tab. */
export function isRunningInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches === true
  return standalone || displayMode
}

/**
 * True for a browser that can install but will never fire the Chromium event —
 * in practice, iOS Safari and every iOS browser, which all use WebKit.
 */
export function needsManualInstallGuidance(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  return isIOS && !isRunningInstalled()
}

/** Test seam. */
export function resetInstallState(): void {
  deferred = null
  listeners.clear()
}
