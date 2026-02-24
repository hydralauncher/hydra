import fs from "node:fs";

export type PathType = "missing" | "directory" | "file" | "other";

export async function getPathType(targetPath: string): Promise<PathType> {
  if (!fs.existsSync(targetPath)) {
    return "missing";
  }

  const stats = await fs.promises.stat(targetPath);

  if (stats.isDirectory()) {
    return "directory";
  }

  if (stats.isFile()) {
    return "file";
  }

  return "other";
}
