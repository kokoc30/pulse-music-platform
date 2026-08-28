import { create } from 'zustand'

/**
 * Small amount of cross-cutting UI state: the reference's `.notice` toast plus
 * the two overlays production adds (queue panel, mobile navigation), and a token
 * the sidebar uses to move focus into the header search field.
 * Everything else stays in component-local state.
 */
export interface UiState {
  notice: string | null
  noticeToken: number
  queueOpen: boolean
  mobileNavOpen: boolean
  focusSearchToken: number
  showNotice: (message: string) => void
  dismissNotice: () => void
  setQueueOpen: (open: boolean) => void
  toggleQueue: () => void
  setMobileNavOpen: (open: boolean) => void
  closeOverlays: () => void
  focusSearch: () => void
}

export const useUiStore = create<UiState>((set) => ({
  notice: null,
  noticeToken: 0,
  queueOpen: false,
  mobileNavOpen: false,
  focusSearchToken: 0,

  showNotice: (message) => set((state) => ({ notice: message, noticeToken: state.noticeToken + 1 })),
  dismissNotice: () => set({ notice: null }),

  setQueueOpen: (queueOpen) => set({ queueOpen, mobileNavOpen: false }),
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen, mobileNavOpen: false })),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  closeOverlays: () => set({ queueOpen: false, mobileNavOpen: false }),
  focusSearch: () =>
    set((state) => ({ focusSearchToken: state.focusSearchToken + 1, mobileNavOpen: false })),
}))

export const showNotice = (message: string): void => useUiStore.getState().showNotice(message)
