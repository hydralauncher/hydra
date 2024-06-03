/// <reference types="vite/client" />
/// <reference types="vite-plugin-comlink/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_STEAMGRIDDB_API_KEY: string;
  readonly MAIN_VITE_ONLINEFIX_USERNAME: string;
  readonly MAIN_VITE_ONLINEFIX_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
