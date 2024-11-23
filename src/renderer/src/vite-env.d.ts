/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly RENDERER_VITE_INTERCOM_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
