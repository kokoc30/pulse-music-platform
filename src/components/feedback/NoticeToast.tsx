import { useEffect } from 'react'
import { useUiStore } from '@/app/ui-store'

export const NOTICE_TIMEOUT_MS = 2600

/** The reference's `.notice` toast, now carrying real playback feedback. */
export function NoticeToast() {
  const notice = useUiStore((s) => s.notice)
  const noticeToken = useUiStore((s) => s.noticeToken)
  const dismissNotice = useUiStore((s) => s.dismissNotice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(dismissNotice, NOTICE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [notice, noticeToken, dismissNotice])

  if (!notice) return null
  return (
    <div className="notice" role="status" aria-live="polite">
      {notice}
    </div>
  )
}
