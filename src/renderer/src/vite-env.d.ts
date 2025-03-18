/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly RENDERER_VITE_EXTERNAL_RESOURCES_URL: string;
  readonly RENDERER_VITE_SENTRY_DSN: string;
  readonly RENDERER_VITE_REAL_DEBRID_REFERRAL_ID: string;
  readonly RENDERER_VITE_TORBOX_REFERRAL_CODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
