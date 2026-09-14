import fs from "node:fs";
import path from "node:path";

export const removeDirectoryQuietly = async (target: string): Promise<void> => {
  await fs.promises
    .rm(target, { recursive: true, force: true })
    .catch(() => {});
};

export const swapDirectory = async (
  stagingDir: string,
  targetDir: string,
  commit: () => Promise<void>
): Promise<void> => {
  await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });

  const backupDir = `${targetDir}.backup`;
  await removeDirectoryQuietly(backupDir);

  const hadPrevious = fs.existsSync(targetDir);
  if (hadPrevious) {
    await fs.promises.rename(targetDir, backupDir);
  }

  try {
    await fs.promises.rename(stagingDir, targetDir);

    if (hadPrevious) {
      await fs.promises.cp(backupDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    }

    await commit();
  } catch (error) {
    await removeDirectoryQuietly(targetDir);
    if (hadPrevious) {
      await fs.promises.rename(backupDir, targetDir).catch(() => {});
    }
    throw error;
  }

  await removeDirectoryQuietly(backupDir);
};
