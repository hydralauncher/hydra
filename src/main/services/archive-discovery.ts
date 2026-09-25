import fs from "node:fs";
import path from "node:path";
export async function listArchiveFiles(
  directoryPath: string,
  maxSubfolderDepth: number,
  archiveExtensions: readonly string[]
): Promise<string[]> {
  const archives: string[] = [];

  const visit = async (relativePath: string, depth: number): Promise<void> => {
    const entries = await fs.promises.readdir(
      path.join(directoryPath, relativePath),
      { withFileTypes: true }
    );

    for (const entry of entries) {
      const entryPath = path.join(relativePath, entry.name);
      if (
        entry.isFile() &&
        archiveExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
      ) {
        archives.push(entryPath);
      } else if (entry.isDirectory() && depth < maxSubfolderDepth) {
        await visit(entryPath, depth + 1);
      }
    }
  };

  await visit("", 0);
  return archives;
}
