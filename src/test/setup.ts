import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetStreamOriginFailures } from '@/music/audius/content-nodes'
import { server } from './msw/server'

/**
 * Makes `AbortSignal` usable under jsdom.
 *
 * The jsdom environment pairs jsdom's `AbortController` with Node's `fetch`
 * (through MSW's interceptor), and Node rejects a signal constructed in the
 * other realm — `Expected signal ("AbortSignal {}") to be an instance of
 * AbortSignal`. Every jsdom-realm signal fails, including `AbortSignal.timeout`
 * and `AbortSignal.any`.
 *
 * A browser has one realm, so production is unaffected and must not be weakened
 * to suit the test environment. The shim therefore honours the signal here
 * instead of forwarding it: the pending promise rejects with a real
 * `AbortError`, which is exactly what the cancelled request would have produced.
 * Stale-search and timeout behaviour stay genuinely under test.
 */
function installAbortSignalShim(): void {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal
    if (!signal) return nativeFetch(input, init)

    const { signal: _ignored, ...rest } = init ?? {}
    if (signal.aborted) return Promise.reject(abortError())

    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      nativeFetch(input, rest)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort))
    })
  })
}

// jsdom implements neither media playback nor these two observers.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  installAbortSignalShim()

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })

  window.HTMLElement.prototype.scrollIntoView = vi.fn()

  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      },
    })
  }
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetStreamOriginFailures()
  localStorage.clear()
})

afterAll(() => server.close())
