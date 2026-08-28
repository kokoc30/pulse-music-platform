import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import { createJamendoMiddleware } from './server/jamendo/node-adapter'
import { createYouTubeMiddleware } from './server/youtube/node-adapter'

// The design reference lives in ./refe and must never be part of the production
// build, dependency graph, or dev-server watch set (agents/04_TARGET_FILE_STRUCTURE.md).
const REFERENCE_DIRS = ['**/refe/**', '**/agents/**', '**/docs/**', '**/test-results/**']

/**
 * Serves `/api/jamendo` and `/api/youtube` locally with the same handlers the
 * Vercel Functions use, so `pnpm dev` needs no Vercel login and no separate
 * backend (agents/13_JAMENDO_PHASE2_ENTRYPOINT.md → "Local Development
 * Requirement"; agents/23_YOUTUBE_SERVERLESS_SECURITY.md → "API Shape").
 *
 * `loadEnv(mode, cwd, '')` reads *every* variable from `.env` files, including
 * the unprefixed `JAMENDO_CLIENT_ID` and `YOUTUBE_API_KEY`. Those values stay
 * inside this Node process: they are handed to the middleware only, never to
 * `define`, never to a `VITE_` variable, and therefore never to the browser
 * bundle.
 */
function providerDevApi(mode: string): Plugin {
  const env: Record<string, string | undefined> = {
    ...loadEnv(mode, process.cwd(), ''),
    // A real process variable (Vercel CLI, CI, shell) outranks the .env file.
    ...(process.env.JAMENDO_CLIENT_ID ? { JAMENDO_CLIENT_ID: process.env.JAMENDO_CLIENT_ID } : {}),
    ...(process.env.YOUTUBE_API_KEY ? { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY } : {}),
  }
  const middlewares = [createJamendoMiddleware({ env }), createYouTubeMiddleware({ env })]

  return {
    name: 'pulse:provider-dev-api',
    apply: () => true,
    configureServer(server) {
      for (const middleware of middlewares) server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      for (const middleware of middlewares) server.middlewares.use(middleware)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), providerDevApi(mode)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @audius/sdk's browser bundle imports these Node-shim packages by bare
      // specifier without declaring them; the trailing slash forces resolution
      // to the installed npm packages instead of Vite's empty browser stubs.
      buffer: 'buffer/',
    },
  },
  optimizeDeps: { include: ['buffer', 'crypto-browserify'] },
  server: {
    port: 5173,
    strictPort: false,
    watch: { ignored: REFERENCE_DIRS },
    fs: { deny: ['**/.env', '**/.env.*'] },
  },
  preview: { port: 4173, strictPort: false },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // @audius/sdk is loaded through a dynamic import in src/music/audius/client.ts,
    // so Rollup splits it out on its own; only the React runtime is pinned here.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
}))
