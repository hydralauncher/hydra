import fs from "node:fs";
import path from "node:path";

const systemProfileNames = new Set([
  "all users",
  "default",
  "default user",
  "defaultuser0",
  "public",
]);

export const resolveWinePrefixPath = async (
  winePrefixPath: string | null,
  homeDir: string
): Promise<string | null> => {
  if (!winePrefixPath) return null;

  let expandedPath = winePrefixPath;
  if (winePrefixPath === "~") {
    expandedPath = homeDir;
  } else if (winePrefixPath.startsWith("~/")) {
    expandedPath = path.join(homeDir, winePrefixPath.slice(2));
  }
  const absolutePath = path.resolve(expandedPath);

  try {
    return await fs.promises.realpath(absolutePath);
  } catch {
    const missingSegments: string[] = [];
    let existingPath = absolutePath;

    while (!fs.existsSync(existingPath)) {
      const parent = path.dirname(existingPath);
      if (parent === existingPath) break;
      missingSegments.push(path.basename(existingPath));
      existingPath = parent;
    }

    const canonicalBase = await fs.promises
      .realpath(existingPath)
      .catch(() => existingPath);
    return path.join(canonicalBase, ...missingSegments.reverse());
  }
};

export const getWinePrefixUserProfiles = (
  winePrefixPath: string,
  homeDir: string
): string[] => {
  const usersPath = path.join(winePrefixPath, "drive_c", "users");

  let entries: string[];
  try {
    entries = fs.readdirSync(usersPath);
  } catch {
    return [];
  }

  const osUserName = path.basename(homeDir).toLowerCase();
  return entries
    .filter((name) => {
      if (systemProfileNames.has(name.toLowerCase())) return false;
      try {
        return fs.statSync(path.join(usersPath, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => {
      const priority = (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === "steamuser") return 0;
        if (normalized === osUserName) return 1;
        return 2;
      };
      return priority(left) - priority(right) || left.localeCompare(right);
    });
};
