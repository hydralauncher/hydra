import type { SteamGameSyncPayload } from "../../../types/steam-integration.types.js";

type SteamGamePageSyncDependencies = {
  waitForFullSync: () => Promise<void>;
  collect: (
    steamAppId: string,
    signal: AbortSignal
  ) => Promise<SteamGameSyncPayload>;
  publish: (
    steamAppId: string,
    payload: SteamGameSyncPayload,
    signal: AbortSignal
  ) => Promise<void>;
  log: (message: string, ...args: unknown[]) => void;
  logError: (message: string, ...args: unknown[]) => void;
};

type SteamGamePageSyncCandidate = {
  isDeleted?: boolean;
  hasActiveSteamImport?: boolean;
};

export const shouldSyncSteamGameOnGamePage = (
  isLoggedIn: boolean,
  game: SteamGamePageSyncCandidate | null | undefined
) =>
  isLoggedIn &&
  Boolean(game) &&
  game?.isDeleted !== true &&
  game?.hasActiveSteamImport === true;

export const createSteamGamePageSync = (
  dependencies: SteamGamePageSyncDependencies
) => {
  const inFlightBySteamAppId = new Map<string, Promise<boolean>>();

  const sync = (steamAppId: string): Promise<boolean> => {
    const currentSync = inFlightBySteamAppId.get(steamAppId);
    if (currentSync !== undefined) return currentSync;

    const syncPromise = (async () => {
      const abortController = new AbortController();

      try {
        await dependencies.waitForFullSync();
        const payload = await dependencies.collect(
          steamAppId,
          abortController.signal
        );
        await dependencies.publish(steamAppId, payload, abortController.signal);
        dependencies.log("Steam game page sync finished", steamAppId);
        return true;
      } catch (error) {
        dependencies.logError("Steam game page sync failed", steamAppId, error);
        return false;
      }
    })().finally(() => {
      if (inFlightBySteamAppId.get(steamAppId) === syncPromise) {
        inFlightBySteamAppId.delete(steamAppId);
      }
    });

    inFlightBySteamAppId.set(steamAppId, syncPromise);
    return syncPromise;
  };

  return { sync };
};
