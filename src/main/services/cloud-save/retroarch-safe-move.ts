import { createHash } from "node:crypto";
import { constants, createReadStream, promises as fs } from "node:fs";
import path from "node:path";

export const hashRetroArchFile = async (filePath: string) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
};

export const copyRetroArchFileVerified = async (
  source: string,
  target: string
) => {
  if (source === target) return;
  const sourceHash = await hashRetroArchFile(source);
  const targetStat = await fs.lstat(target).catch(() => null);
  if (targetStat) {
    if (
      !targetStat.isFile() ||
      targetStat.isSymbolicLink() ||
      (await hashRetroArchFile(target)) !== sourceHash
    ) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
  } else {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    if ((await hashRetroArchFile(target)) !== sourceHash) {
      await fs.unlink(target).catch(() => undefined);
      throw new Error("cloud_save_retroarch_copy_failed");
    }
  }
};

export const moveRetroArchFileVerified = async (
  source: string,
  target: string
) => {
  if (source === target) return;
  await copyRetroArchFileVerified(source, target);
  if ((await hashRetroArchFile(source)) !== (await hashRetroArchFile(target))) {
    throw new Error("cloud_save_retroarch_source_changed");
  }
  await fs.unlink(source);
};
