import path from "node:path";

export const STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS = 3_000;

export const isSteamLibraryExecutablePath = (
  executablePath: string,
  libraryFolders: string[],
  platform: NodeJS.Platform = process.platform
): boolean => {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(executablePath)) return false;

  return libraryFolders.some((libraryFolder) => {
    if (!paths.isAbsolute(libraryFolder)) return false;
    const root = paths.join(libraryFolder, "steamapps", "common");
    const relative = paths.relative(root, executablePath);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(relative)
    );
  });
};

export const resolveSteamSessionPlaytimePolicy = ({
  hasActiveSteamImport,
  isSteamLibraryPath,
  disableHydraPlaytimeTracking,
}: {
  hasActiveSteamImport: boolean;
  isSteamLibraryPath: boolean;
  disableHydraPlaytimeTracking: boolean;
}) => ({
  countHydraPlaytime:
    !hasActiveSteamImport ||
    (!isSteamLibraryPath && !disableHydraPlaytimeTracking),
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
