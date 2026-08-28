import { Buffer } from 'buffer'

/**
 * `@audius/sdk`'s browser bundle and its transitive browserify shims
 * (`crypto-browserify`, `cipher-base`, `readable-stream`, `asn1.js`) reference
 * the Node globals `global`, `Buffer` and `process`, none of which exist in a
 * browser. The SDK does not ship these itself, so the application supplies the
 * minimum surface those shims actually touch: `process.nextTick`,
 * `process.env`, `process.browser` and `process.version`.
 *
 * This module must be evaluated before anything loads the SDK. ES module
 * evaluation order guarantees that, because it is the first import in
 * `main.tsx` and the SDK is reached through a later dynamic import.
 */
interface MinimalProcess {
  env: Record<string, string | undefined>
  browser: boolean
  version: string
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
}

interface PolyfilledScope {
  global?: unknown
  Buffer?: unknown
  process?: unknown
}

// Documented compatibility cast at an external-SDK boundary: `@types/node`
// declares a full `process` on `globalThis`, which cannot be narrowed to the
// small shim installed here without going through `unknown`.
const scope = globalThis as unknown as PolyfilledScope

const nodeProcess: MinimalProcess = {
  env: {},
  browser: true,
  version: '',
  nextTick: (callback, ...args) => {
    queueMicrotask(() => callback(...args))
  },
}

scope.global ??= globalThis
scope.Buffer ??= Buffer
scope.process ??= nodeProcess

export {}
