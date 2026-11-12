import { existsSync } from "node:fs";
import path from "node:path";

const EXPORTS_BIN_SUFFIX = "/flatpak/exports/bin";
const SYSTEM_EXPORTS_BIN = "/var/lib/flatpak/exports/bin";
const FLATPAK_APP_ID = /^[A-Za-z_][\w-]*(\.[\w-]+){2,}$/;

export interface FlatpakEmulatorLaunchOptions {
  executableTarget: string;
  args: string[];
  accessiblePaths: string[];
  flatpakCommand: string | null;
  homePath: string;
  platform?: NodeJS.Platform;
}

export interface FlatpakEmulatorLaunch {
  command: string;
  args: string[];
}

export const findFlatpakCommand = (
  searchPath = process.env["PATH"] ?? ""
): string | null => {
  const directories = [
    ...searchPath.split(path.delimiter).filter(Boolean),
    "/usr/bin",
    "/usr/local/bin",
  ];
  for (const directory of directories) {
    const candidate = path.join(directory, "flatpak");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const getInstallationFlag = (exportsBin: string, homePath: string) => {
  if (exportsBin === SYSTEM_EXPORTS_BIN) return "--system";
  if (
    exportsBin ===
    path.posix.join(homePath, ".local", "share", "flatpak", "exports", "bin")
  ) {
    return "--user";
  }
  return null;
};

export const resolveFlatpakEmulatorLaunch = ({
  executableTarget,
  args,
  accessiblePaths,
  flatpakCommand,
  homePath,
  platform = process.platform,
}: FlatpakEmulatorLaunchOptions): FlatpakEmulatorLaunch | null => {
  if (platform !== "linux" || !flatpakCommand) return null;

  const normalizedTarget = path.posix.normalize(executableTarget);
  const exportsBin = path.posix.dirname(normalizedTarget);
  const appId = path.posix.basename(normalizedTarget);
  if (!exportsBin.endsWith(EXPORTS_BIN_SUFFIX) || !FLATPAK_APP_ID.test(appId)) {
    return null;
  }

  const sharedDirectories = [
    ...new Set(
      accessiblePaths
        .filter((accessiblePath) => path.posix.isAbsolute(accessiblePath))
        .map((accessiblePath) =>
          path.posix.dirname(path.posix.normalize(accessiblePath))
        )
        .filter((directory) => directory !== "/" && !directory.includes(":"))
    ),
  ];
  if (!sharedDirectories.length) return null;

  const installationFlag = getInstallationFlag(exportsBin, homePath);

  return {
    command: flatpakCommand,
    args: [
      "run",
      ...(installationFlag ? [installationFlag] : []),
      ...sharedDirectories.map((directory) => `--filesystem=${directory}`),
      appId,
      ...args,
    ],
  };
};
