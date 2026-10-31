export const STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS = 3_000;

export const resolveSteamSessionPlaytimePolicy = ({
  hasActiveSteamImport,
  isSteamLibraryPath,
  enableHydraPlaytimeTracking,
}: {
  hasActiveSteamImport: boolean;
  isSteamLibraryPath: boolean;
  enableHydraPlaytimeTracking: boolean;
}) => ({
  countHydraPlaytime:
    !hasActiveSteamImport || !isSteamLibraryPath || enableHydraPlaytimeTracking,
  syncSteamOnExit: hasActiveSteamImport && isSteamLibraryPath,
});

// Bound the entire lookup, including any auth refresh before the HTTP request.
export const resolveActiveSteamImport = async (
  cachedValue: boolean | undefined,
  loadStatus: (
    signal: AbortSignal
  ) => Promise<{ hasActiveSteamImport?: boolean }>
): Promise<boolean> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("steam-playtime-lookup-timeout"));
    }, STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS);
  });

  try {
    const status = await Promise.race([
      loadStatus(controller.signal),
      deadline,
    ]);
    return status.hasActiveSteamImport === true;
  } catch {
    return cachedValue === true;
  } finally {
    clearTimeout(timeout);
  }
};
