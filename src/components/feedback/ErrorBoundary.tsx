import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Last-resort guard so a render failure never leaves a blank page. Logs a safe
 * message only — never configuration or credentials.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Pulse render error:', error.message, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="pulse-app">
        <div className="browse-surface" style={{ margin: 8, minHeight: '60vh' }}>
          <div className="browse-content">
            <div className="empty-results is-error" role="alert">
              <h2>Something went wrong</h2>
              <p>Reload the page to keep listening.</p>
              <button type="button" className="retry-button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
