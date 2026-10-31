export const isValidProcessWatcherScan = <T>(scan: T | null): scan is T =>
  scan !== null;

export const startOptionalExecutableCatalogueLoad = (
  loadOptionalExecutableCatalogue: () => Promise<boolean>
) => {
  void loadOptionalExecutableCatalogue().catch(() => false);
};
