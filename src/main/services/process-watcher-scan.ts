export const isValidProcessWatcherScan = <T>(scan: T | null): scan is T =>
  scan !== null;

export const shouldBroadcastGamesRunning = (
  gamesRunningCount: number,
  lastBroadcastWasEmpty: boolean
) => gamesRunningCount > 0 || !lastBroadcastWasEmpty;

export const startOptionalExecutableCatalogueLoad = (
  loadOptionalExecutableCatalogue: () => Promise<boolean>
) => {
  void loadOptionalExecutableCatalogue().catch(() => false);
};
