export const removeAppImageLibraryPath = (
  env: NodeJS.ProcessEnv = process.env
) => {
  const appDir = env.APPDIR;
  const libraryPath = env.LD_LIBRARY_PATH;

  if (!env.APPIMAGE || !appDir || libraryPath === undefined) return;

  const isInsideAppDir = (entry: string) =>
    entry === appDir || entry.startsWith(`${appDir}/`);

  const remainingEntries = libraryPath
    .split(":")
    .filter((entry) => entry && !isInsideAppDir(entry));

  if (remainingEntries.length > 0) {
    env.LD_LIBRARY_PATH = remainingEntries.join(":");
  } else {
    delete env.LD_LIBRARY_PATH;
  }
};
