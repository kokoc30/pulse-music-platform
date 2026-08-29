import { create } from 'zustand'

/**
 * Small amount of cross-cutting UI state: the reference's `.notice` toast plus
 * the two overlays production adds (queue panel, mobile navigation), and a token
 * the sidebar uses to move focus into the header search field.
 * Everything else stays in component-local state.
 */
/**
 * An optional single action carried by a toast — in practice, Undo.
 *
 * It belongs on the notice rather than in the component that raised it, because
 * the toast outlives its trigger: by the time the visitor reads "Hidden from
 * your recommendations", the row and its menu are gone from the shelf, so
 * nothing local is still mounted to own the reversal (agents/43 → "allow undo
 * from toast").
 */
export interface NoticeAction {
  label: string
  run: () => void
}

export interface UiState {
  notice: string | null
  noticeAction: NoticeAction | null
  noticeToken: number
  queueOpen: boolean
  mobileNavOpen: boolean
  /**
   * Whether the audio player is showing its full Now Playing view.
   *
   * Presentation only. It lives beside the queue panel and the mobile drawer
   * because it is the same kind of thing — a surface the visitor opened — and
   * deliberately *not* in `player-store`, which owns playback. Nothing here can
   * start, stop or reload a track: expanding is a change of view over the one
   * running `HTMLAudioElement`, and collapsing is the same view going away.
   */
  nowPlayingOpen: boolean
  focusSearchToken: number
  /**
   * Bumped when the bottom bar asks the visible video player for attention.
   *
   * The bar is supplemental UI; the official player is the authority. Tapping
   * the bar therefore points at that player rather than opening a second view
   * of it, and this token is how it says so without either component importing
   * the other.
   */
  focusVideoToken: number
  showNotice: (message: string, action?: NoticeAction) => void
  dismissNotice: () => void
  setQueueOpen: (open: boolean) => void
  toggleQueue: () => void
  setMobileNavOpen: (open: boolean) => void
  setNowPlayingOpen: (open: boolean) => void
  closeOverlays: () => void
  focusSearch: () => void
  focusVideo: () => void
}

export const useUiStore = create<UiState>((set) => ({
  notice: null,
  noticeAction: null,
  noticeToken: 0,
  queueOpen: false,
  mobileNavOpen: false,
  nowPlayingOpen: false,
  focusSearchToken: 0,
  focusVideoToken: 0,

  showNotice: (message, action) =>
    set((state) => ({
      notice: message,
      noticeAction: action ?? null,
      noticeToken: state.noticeToken + 1,
    })),
  dismissNotice: () => set({ notice: null, noticeAction: null }),

  setQueueOpen: (queueOpen) => set({ queueOpen, mobileNavOpen: false }),
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen, mobileNavOpen: false })),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen, mobileNavOpen: false }),
  closeOverlays: () => set({ queueOpen: false, mobileNavOpen: false, nowPlayingOpen: false }),
  focusSearch: () =>
    set((state) => ({ focusSearchToken: state.focusSearchToken + 1, mobileNavOpen: false })),
  focusVideo: () => set((state) => ({ focusVideoToken: state.focusVideoToken + 1 })),
}))

export const showNotice = (message: string, action?: NoticeAction): void =>
  useUiStore.getState().showNotice(message, action)
