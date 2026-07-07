import type { CloudSaveManifestSource } from "./types";

export const DEFAULT_CLOUD_SAVE_MANIFEST_URL =
  "https://cdn.losbroxas.org/manifest.yaml";

export const getSaveManifestSource = (): CloudSaveManifestSource => {
  const configuredUrl =
    import.meta.env.MAIN_VITE_CLOUD_SAVE_MANIFEST_URL?.trim();

  return {
    url: configuredUrl || DEFAULT_CLOUD_SAVE_MANIFEST_URL,
  };
};
