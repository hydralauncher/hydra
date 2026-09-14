export const isValidProcessWatcherScan = <T>(scan: T | null): scan is T =>
  scan !== null;
