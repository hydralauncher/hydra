/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY: string;
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_SENTRY_DSN: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
