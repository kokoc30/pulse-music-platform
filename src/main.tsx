// Must be first: installs the Node globals @audius/sdk's browser bundle expects.
import '@/lib/browser-polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/app/App'
import { createAudiusProvider } from '@/music/audius/adapter'
import { setMusicProvider } from '@/music/provider'
import { watchInstallAvailability } from '@/pwa/install'
import { registerServiceWorker } from '@/pwa/register-sw'
import '@/styles/index.css'

// One provider instance for the whole application, registered before render.
setMusicProvider(createAudiusProvider())

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

// Capture the browser's install offer before first paint, so Settings can
// replay it from a real gesture. Suppressing the default prompt is what keeps
// it out of the visitor's way until they ask.
watchInstallAvailability()

// The app-shell worker, production only: a worker in dev would serve stale
// modules over Vite's HMR. It never caches provider audio or /api/* (public/sw.js).
if (import.meta.env.PROD) void registerServiceWorker()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
