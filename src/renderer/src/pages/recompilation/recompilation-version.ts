export const formatRecompilationVersion = (version: string | null) =>
  version && /^\d/.test(version) ? `v${version}` : (version ?? "");
