/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY: string;
  readonly MAIN_VITE_ONLINEFIX_USERNAME: string;
  readonly MAIN_VITE_ONLINEFIX_PASSWORD: string;
  readonly MAIN_VITE_SENTRY_DSN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
