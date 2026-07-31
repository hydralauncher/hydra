import fs from "node:fs";
import path from "node:path";

const removeQuietly = async (target: string): Promise<void> => {
  await fs.promises.rm(target, { force: true }).catch(() => {});
};

/**
 * Puts `stagedLibrary` in place at `libraryPath` and persists the matching
 * config as a single step.
 *
 * The previous library is held as a backup until `persistConfig` resolves. If
 * the config write rejects, the new binary would otherwise stay on disk while
 * the config still described the old core, with no copy left to roll back to.
 */
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
