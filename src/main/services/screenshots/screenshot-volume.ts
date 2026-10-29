import fs from "node:fs";

export const readVolumeId = async (targetPath: string) => {
  try {
    return (await fs.promises.stat(targetPath)).dev;
  } catch {
    return null;
  }
};
