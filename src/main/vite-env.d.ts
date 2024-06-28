/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY: string;
  readonly MAIN_VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
