type SteamConnectionStatus = { connected: boolean };
type SteamSyncOrigin = "manual" | "startup";

type StartupSyncDependencies = {
  isLoggedIn: () => boolean;
  getStatus: () => Promise<SteamConnectionStatus>;
  startSync: (origin: SteamSyncOrigin) => Promise<unknown>;
  logError: (message: string, error: unknown) => void;
};

export const createSteamStartupSync = (
  dependencies: StartupSyncDependencies
) => {
  let attempted = false;

  return {
    async run() {
      if (attempted || !dependencies.isLoggedIn()) return;
      attempted = true;

      try {
        const status = await dependencies.getStatus();
        if (!status.connected) return;

        await dependencies.startSync("startup");
      } catch (error) {
        dependencies.logError("Steam startup sync failed", error);
      }
    },
    reset() {
      attempted = false;
    },
  };
};
