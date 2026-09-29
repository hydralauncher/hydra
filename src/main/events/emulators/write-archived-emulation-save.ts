import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type FileOperations = Pick<typeof fs, "lstat" | "writeFile" | "rename" | "rm">;

export const writeArchivedEmulationSave = async (
  destination: string,
  bytes: Buffer,
  files: FileOperations = fs
): Promise<void> => {
  const destinationStat = await files.lstat(destination).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (destinationStat?.isSymbolicLink()) {
    throw new Error("archive_export_symlink_target");
  }
  if (destinationStat && !destinationStat.isFile()) {
    throw new Error("archive_export_invalid_target");
  }

  const temporaryPath = path.join(
    path.dirname(destination),
    `.hydra-archive-${randomUUID()}.tmp`
  );
  const backupPath = path.join(
    path.dirname(destination),
    `.hydra-archive-${randomUUID()}.bak`
  );
  let existingMoved = false;
  try {
    await files.writeFile(temporaryPath, bytes, { flag: "wx" });
    if (destinationStat) {
      await files.rename(destination, backupPath);
      existingMoved = true;
    }
    await files.rename(temporaryPath, destination);
  } catch (error) {
    if (existingMoved) {
      await files.rename(backupPath, destination);
    }
    throw error;
  } finally {
    await files.rm(temporaryPath, { force: true }).catch(() => {});
  }

  if (existingMoved) {
    await files.rm(backupPath, { force: true }).catch(() => {});
  }
};
