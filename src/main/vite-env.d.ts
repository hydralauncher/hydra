/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY: string;
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_ANALYTICS_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
  readonly MAIN_VITE_RPC_GAME_EXECUTABLES_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
