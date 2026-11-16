import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logsPath } from "@main/constants";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";
import type { MacCompatibilityStatus, ProtonVersion } from "@types";
import { logger } from "./logger";
import { getSteamLibraryFolders, getSteamLocation } from "./steam";
import { SystemPath } from "./system-path";

export const NOTPROTON_REQUIRED_ERROR = "notproton-crossover-required";

const findCrossOverApp = (): string | null => {
  const home = SystemPath.getPath("home");
  const candidates = [
    "/Applications/CrossOver.app",
    path.join(home, "Applications", "CrossOver.app"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const hasNotProtonInstallation = (): boolean => {
  const home = SystemPath.getPath("home");
  const candidates = [
    "/Applications/NotProton.app",
    path.join(home, "Applications", "NotProton.app"),
    path.join(home, "Library", "Application Support", "notproton"),
  ];

  return candidates.some((candidate) => fs.existsSync(candidate));
};

export const isValidNotProtonDirectory = (directoryPath: string): boolean => {
  const runScriptPath = path.join(directoryPath, "run");
  const toolManifestPath = path.join(directoryPath, "toolmanifest.vdf");

  return fs.existsSync(runScriptPath) && fs.existsSync(toolManifestPath);
};

export const getNotProtonToolName = (directoryPath: string): string => {
  const folderName = path.basename(directoryPath);
  const vdfPath = path.join(directoryPath, "compatibilitytool.vdf");

  try {
    const content = fs.readFileSync(vdfPath, "utf8");
    const match = content.match(/"display_name"\s+"([^"]+)"/);
    if (match?.[1]) {
      return `${match[1]} (${folderName})`;
    }
  } catch {
    // Fall back to folder name when compatibilitytool.vdf is unreadable.
  }

  return folderName;
};

export const getMacCompatibilityTools = async (): Promise<ProtonVersion[]> => {
  if (process.platform !== "darwin") return [];

  const home = SystemPath.getPath("home");
  const defaultSteamRoot = path.join(
    home,
    "Library",
    "Application Support",
    "Steam"
  );
  const detectedSteamRoot = await getSteamLocation().catch(() => null);
  const libraryFolders = await getSteamLibraryFolders().catch(() => []);

  const compatibilityRoots = [
    ...new Set(
      [defaultSteamRoot, detectedSteamRoot, ...libraryFolders]
        .filter((root): root is string => Boolean(root))
        .map((root) => path.join(root, "compatibilitytools.d"))
    ),
  ];

  const toolsByPath = new Map<string, ProtonVersion>();

  for (const compatibilityRoot of compatibilityRoots) {
    if (!fs.existsSync(compatibilityRoot)) continue;

    const entries = await fs.promises
      .readdir(compatibilityRoot, { withFileTypes: true })
      .catch(() => [] as fs.Dirent[]);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const candidatePath = path.join(compatibilityRoot, entry.name);
      if (!isValidNotProtonDirectory(candidatePath)) continue;

      const realPath = await fs.promises.realpath(candidatePath);
      toolsByPath.set(realPath, {
        name: getNotProtonToolName(realPath),
        path: realPath,
        source: "compatibility_tools",
      });
    }
  }

  return Array.from(toolsByPath.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
};

export const getMacCompatibilityStatus =
  async (): Promise<MacCompatibilityStatus> => {
    const crossOverPath = findCrossOverApp();
    const notProtonTools = await getMacCompatibilityTools();
    const hasNotProtonApp =
      hasNotProtonInstallation() || notProtonTools.length > 0;
    const hasCrossOver = Boolean(crossOverPath);

    return {
      hasCrossOver,
      hasNotProtonApp,
      crossOverPath,
      notProtonTools,
      isReady: hasCrossOver && notProtonTools.length > 0,
    };
  };

const resolveCompatDataPath = (
  winePrefixPath?: string | null,
  objectId?: string
): string => {
  if (winePrefixPath) {
    return path.basename(winePrefixPath) === "pfx"
      ? path.dirname(winePrefixPath)
      : winePrefixPath;
  }

  const safeId = (objectId || "default").replaceAll(/[^\w.-]/g, "_");
  return path.join(SystemPath.getPath("userData"), "wine-prefixes", safeId);
};

export interface LaunchMacWindowsOptions {
  executablePath: string;
  objectId: string;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  launchOptions?: string | null;
  shortcutArgs?: string[];
  workingDirectory?: string | null;
}

export const launchWindowsExecutableWithNotProton = async (
  options: LaunchMacWindowsOptions
): Promise<number | null> => {
  const status = await getMacCompatibilityStatus();
  if (!status.isReady) {
    throw new Error(NOTPROTON_REQUIRED_ERROR);
  }

  const runnerPath =
    options.protonPath && isValidNotProtonDirectory(options.protonPath)
      ? options.protonPath
      : status.notProtonTools[0]?.path;

  if (!runnerPath) {
    throw new Error(NOTPROTON_REQUIRED_ERROR);
  }

  const runScript = path.join(runnerPath, "run");
  try {
    fs.chmodSync(runScript, 0o755);
  } catch {
    // Ignore permission errors on read-only paths.
  }

  const compatDataPath = resolveCompatDataPath(
    options.winePrefixPath,
    options.objectId
  );
  fs.mkdirSync(compatDataPath, { recursive: true });

  const steamClientPath = await getSteamLocation().catch(() =>
    path.join(
      SystemPath.getPath("home"),
      "Library",
      "Application Support",
      "Steam"
    )
  );

  const workingDirectory =
    options.workingDirectory ?? path.dirname(options.executablePath);
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: runScript,
    baseArgs: [
      "waitforexitandrun",
      options.executablePath,
      ...(options.shortcutArgs ?? []),
    ],
    launchOptions: options.launchOptions,
  });

  const safeObjectId = options.objectId.replaceAll(/[^\w.-]/g, "_");
  const logFilePath = path.join(logsPath, `notproton-${safeObjectId}.log`);
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    STEAM_COMPAT_INSTALL_PATH: path.dirname(options.executablePath),
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamClientPath,
    ...(/^\d+$/.test(options.objectId)
      ? { STEAM_COMPAT_APP_ID: options.objectId }
      : {}),
    ...resolvedLaunchCommand.env,
  };

  logger.info("Launching Windows executable via NotProton on macOS", {
    runnerPath,
    executablePath: options.executablePath,
    compatDataPath,
    logFilePath,
  });

  const logFd = fs.openSync(logFilePath, "a");
  try {
    const child = spawn(
      resolvedLaunchCommand.command,
      resolvedLaunchCommand.args,
      {
        shell: false,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        cwd: workingDirectory,
        env,
      }
    );

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (err) => reject(err));
    });

    child.unref();
    return child.pid ?? null;
  } finally {
    fs.closeSync(logFd);
  }
};
