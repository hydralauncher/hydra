import { MacCompatibilityManager } from "./MacCompatibilityManager";

let sharedManager: MacCompatibilityManager | null = null;

/**
 * Mac compatibility work only makes sense on macOS. Everywhere else the
 * callers get a safe "not supported" answer instead of running mac-only
 * commands.
 */
export const isMacCompatibilitySupported = (): boolean =>
  process.platform === "darwin";

/**
 * One shared manager for the whole main process, so the panel and the
 * game launcher always read and write the same registry cache instead of
 * fighting over two separate in-memory copies.
 */
export const getMacCompatibilityManager = (): MacCompatibilityManager => {
  if (!sharedManager) {
    sharedManager = new MacCompatibilityManager();
  }

  return sharedManager;
};
