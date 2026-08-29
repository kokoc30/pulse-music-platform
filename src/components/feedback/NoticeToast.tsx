import { useEffect } from 'react'
import { useUiStore } from '@/app/ui-store'

export const NOTICE_TIMEOUT_MS = 2600
/**
 * A toast carrying an action stays a little longer.
 *
 * Reading a message takes a moment; reading it, deciding it was a mistake and
 * reaching Undo takes longer. Two and a half seconds is enough to notice
 * something, not enough to undo it.
 */
export const NOTICE_ACTION_TIMEOUT_MS = 6000

/** The reference's `.notice` toast, now carrying real playback feedback. */
export function NoticeToast() {
  const notice = useUiStore((s) => s.notice)
  const noticeAction = useUiStore((s) => s.noticeAction)
  const noticeToken = useUiStore((s) => s.noticeToken)
  const dismissNotice = useUiStore((s) => s.dismissNotice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(
      dismissNotice,
      noticeAction ? NOTICE_ACTION_TIMEOUT_MS : NOTICE_TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  }, [notice, noticeToken, noticeAction, dismissNotice])

  if (!notice) return null
  return (
    <div className="notice" role="status" aria-live="polite">
      <span>{notice}</span>
      {noticeAction ? (
        <button
          type="button"
          className="notice-action"
          onClick={() => {
            noticeAction.run()
            dismissNotice()
          }}
        >
          {noticeAction.label}
        </button>
      ) : null}
    </div>
  )
}
