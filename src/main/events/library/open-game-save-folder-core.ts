type OpenGameSaveFolderInput = {
  saveFolderPath: string;
  platform: NodeJS.Platform;
  exists: (folderPath: string) => boolean;
  openPath: (folderPath: string) => Promise<string>;
};

export const getGameSaveFolderShellPath = (
  folderPath: string,
  platform: NodeJS.Platform
) => {
  if (platform !== "win32") return folderPath;

  const windowsPath = folderPath.replaceAll("/", "\\");
  const lowerPath = windowsPath.toLowerCase();

  if (lowerPath.startsWith("\\\\?\\unc\\")) {
    return `\\\\${windowsPath.slice(8)}`;
  }

  if (/^\\\\\?\\[a-z]:\\/i.test(windowsPath)) {
    return windowsPath.slice(4);
  }

  return folderPath;
};

export const openExistingGameSaveFolder = async ({
  saveFolderPath,
  platform,
  exists,
  openPath,
}: OpenGameSaveFolderInput): Promise<boolean> => {
  if (!saveFolderPath) return false;

  try {
    if (!exists(saveFolderPath)) return false;

    const openError = await openPath(
      getGameSaveFolderShellPath(saveFolderPath, platform)
    );
    return openError.length === 0;
  } catch {
    return false;
  }
};
