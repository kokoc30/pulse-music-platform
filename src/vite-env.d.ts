/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIUS_API_KEY?: string
  readonly VITE_AUDIUS_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
