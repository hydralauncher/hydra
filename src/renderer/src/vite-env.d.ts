/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly RENDERER_VITE_EXTERNAL_RESOURCES_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
