/**
 * A controllable `IntersectionObserver`, for the one rule that depends on one.
 *
 * jsdom implements no `IntersectionObserver` at all, which is why the visibility
 * gate has always been driven in tests by writing a ratio straight into
 * `youtube-visibility`. That is fine for asserting what `mayAutoplay` does with
 * a number, and useless for the defect this was written for: the reported bug
 * was entirely about *when* the number arrives relative to the player being
 * revealed, and a test that sets the ratio up front can never see it.
 *
 * So this installs a real observer object with the real contract — construct,
 * `observe`, report an entry, `disconnect` — whose reported ratio the test
 * chooses. The application code is untouched: it constructs an
 * `IntersectionObserver`, observes the stage element, and receives an entry it
 * did not write. What a test controls is the environment, not the production
 * decision.
 *
 * The initial report on `observe` is deliberate rather than a convenience: a
 * real `IntersectionObserver` delivers an initial observation as soon as it has
 * one, which is exactly the event the reveal-then-measure hand-off is waiting
 * for.
 */

export interface IntersectionHarness {
  /**
   * The ratio every observation reports, from now on.
   *
   * Set before the transition under test, so the observation that arrives is a
   * consequence of the stage mounting rather than of the test writing a value
   * into the module the production code reads.
   */
  setRatio(ratio: number): void
  /** Re-reports the current ratio for everything under observation. */
  report(ratio?: number): void
  /** Every element currently observed, in the order observation began. */
  observed(): Element[]
  /** How many observers have been constructed and not disconnected. */
  activeObservers(): number
  restore(): void
}

interface Registered {
  callback: IntersectionObserverCallback
  observer: IntersectionObserver
  elements: Element[]
}

/**
 * Installs the fake for the duration of a test. Call `restore()` afterwards.
 *
 * Returns a harness rather than a class so a test never has to reach for the
 * global it replaced.
 */
export function installIntersectionObserver(initialRatio = 0): IntersectionHarness {
  const previous: unknown = Reflect.get(globalThis, 'IntersectionObserver')
  const registered = new Set<Registered>()
  let ratio = initialRatio

  const entryFor = (target: Element): IntersectionObserverEntry => ({
    target,
    intersectionRatio: ratio,
    isIntersecting: ratio > 0,
    boundingClientRect: target.getBoundingClientRect(),
    intersectionRect: target.getBoundingClientRect(),
    rootBounds: null,
    time: 0,
  })

  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = '0px'
    readonly thresholds: readonly number[] = []
    #entry: Registered

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.thresholds = Array.isArray(options?.threshold)
        ? options.threshold
        : [options?.threshold ?? 0]
      this.#entry = { callback, observer: this, elements: [] }
      registered.add(this.#entry)
    }

    observe(target: Element): void {
      this.#entry.elements.push(target)
      // The initial observation a real implementation delivers once it has one.
      this.#entry.callback([entryFor(target)], this)
    }

    unobserve(target: Element): void {
      this.#entry.elements = this.#entry.elements.filter((element) => element !== target)
    }

    disconnect(): void {
      this.#entry.elements = []
      registered.delete(this.#entry)
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  Reflect.set(globalThis, 'IntersectionObserver', FakeIntersectionObserver)

  const report = (next?: number) => {
    if (typeof next === 'number') ratio = next
    for (const entry of [...registered]) {
      if (entry.elements.length === 0) continue
      entry.callback(
        entry.elements.map((element) => entryFor(element)),
        entry.observer,
      )
    }
  }

  return {
    setRatio(next) {
      ratio = next
    },
    report,
    observed: () => [...registered].flatMap((entry) => entry.elements),
    activeObservers: () => registered.size,
    restore() {
      registered.clear()
      if (previous === undefined) {
        Reflect.deleteProperty(globalThis, 'IntersectionObserver')
        return
      }
      Reflect.set(globalThis, 'IntersectionObserver', previous)
    },
  }
}
