import fs from "node:fs";
import path from "node:path";

const removeQuietly = async (target: string): Promise<void> => {
  await fs.promises.rm(target, { force: true }).catch(() => {});
};

export const swapCoreLibrary = async (
  stagedLibrary: string,
  libraryPath: string,
  persistConfig: () => Promise<void>
): Promise<void> => {
  await fs.promises.mkdir(path.dirname(libraryPath), { recursive: true });

  const backupPath = `${libraryPath}.backup`;
  await removeQuietly(backupPath);

  const hadPrevious = fs.existsSync(libraryPath);
  if (hadPrevious) {
    await fs.promises.rename(libraryPath, backupPath);
  }

  try {
    await fs.promises.copyFile(stagedLibrary, libraryPath);
    await persistConfig();
  } catch (error) {
    await removeQuietly(libraryPath);
    if (hadPrevious) {
      await fs.promises.rename(backupPath, libraryPath).catch(() => {});
    }
    throw error;
  }

  await removeQuietly(backupPath);
};
