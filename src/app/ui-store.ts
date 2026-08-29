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
  focusSearchToken: number
  showNotice: (message: string, action?: NoticeAction) => void
  dismissNotice: () => void
  setQueueOpen: (open: boolean) => void
  toggleQueue: () => void
  setMobileNavOpen: (open: boolean) => void
  closeOverlays: () => void
  focusSearch: () => void
}

export const useUiStore = create<UiState>((set) => ({
  notice: null,
  noticeAction: null,
  noticeToken: 0,
  queueOpen: false,
  mobileNavOpen: false,
  focusSearchToken: 0,

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
  closeOverlays: () => set({ queueOpen: false, mobileNavOpen: false }),
  focusSearch: () =>
    set((state) => ({ focusSearchToken: state.focusSearchToken + 1, mobileNavOpen: false })),
}))

export const showNotice = (message: string, action?: NoticeAction): void =>
  useUiStore.getState().showNotice(message, action)
