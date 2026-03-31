/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_API_URL: string;
  readonly MAIN_VITE_ANALYTICS_API_URL: string;
  readonly MAIN_VITE_AUTH_URL: string;
  readonly MAIN_VITE_CHECKOUT_URL: string;
  readonly MAIN_VITE_EXTERNAL_RESOURCES_URL: string;
  readonly MAIN_VITE_WS_URL: string;
  readonly MAIN_VITE_NIMBUS_API_URL: string;
  readonly MAIN_VITE_LAUNCHER_SUBDOMAIN: string;
  readonly MAIN_VITE_UNLOCKERS_MANIFEST_URL: string;
  readonly MAIN_VITE_UNLOCKERS_SIGNATURE_URL: string;
  readonly MAIN_VITE_UNLOCKERS_PUBLIC_KEY: string;
  readonly ELECTRON_RENDERER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
