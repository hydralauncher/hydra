/** "v1.2" for numbered releases; tags like "beta-rc1" are shown as they are. */
export const formatRecompilationVersion = (version: string | null) =>
  version && /^\d/.test(version) ? `v${version}` : (version ?? "");
