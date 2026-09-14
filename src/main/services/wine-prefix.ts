import fs from "node:fs";
import path from "node:path";

import { parseRegFile } from "../helpers/reg-parser.js";

const systemProfileNames = new Set([
  "all users",
  "default",
  "default user",
  "defaultuser0",
  "public",
]);

export interface WinePrefixUserProfile {
  name: string;
  path: string;
  windowsPath: string;
}

const trimTrailingForwardSlashes = (value: string) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

export const getWinePrefixWindowsUserProfilePath = (
  winePrefixPath: string
): string | null => {
  try {
    const userReg = fs.readFileSync(
      path.join(winePrefixPath, "user.reg"),
      "utf8"
    );
    const volatileEnvironment = parseRegFile(userReg).find(
      (entry) => entry.path === "Volatile Environment"
    );
    const rawUserProfile = volatileEnvironment?.values["USERPROFILE"];
    if (typeof rawUserProfile !== "string" || !rawUserProfile.trim()) {
      return null;
    }
    return trimTrailingForwardSlashes(
      path.posix.normalize(rawUserProfile.replaceAll(/\\+/g, "/"))
    );
  } catch {
    return null;
  }
};

export const getWinePrefixUserProfile = (
  winePrefixPath: string
): WinePrefixUserProfile | null => {
  try {
    const windowsPath = getWinePrefixWindowsUserProfilePath(winePrefixPath);
    if (!windowsPath) return null;
    const match = /^C:\/users\/([^/]+)$/i.exec(windowsPath);
    if (!match) return null;

    const name = match[1];
    if (systemProfileNames.has(name.toLowerCase())) return null;

    const usersRoot = fs.realpathSync(
      path.join(winePrefixPath, "drive_c", "users")
    );
    const profilePath = fs.realpathSync(path.join(usersRoot, name));
    const relative = path.relative(usersRoot, profilePath);
    if (
      relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative)
    ) {
      return {
        name,
        path: profilePath,
        windowsPath,
      };
    }
  } catch {
    return null;
  }

  return null;
};

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
    missingSegments.reverse();
    return path.join(canonicalBase, ...missingSegments);
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
