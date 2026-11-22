import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logsPath } from "@main/constants";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";
import type { MacCompatibilityStatus, ProtonVersion } from "@types";
import { logger } from "./logger";
import { getSteamLibraryFolders, getSteamLocation } from "./steam";
import { SystemPath } from "./system-path";

const execFileAsync = promisify(execFile);
const MAC_PREFIX_PREPARE_TIMEOUT_MS = 120_000;
const COMPAT_WRAPPER_HASH_LENGTH = 16;

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

const resolveNotProtonEntry = async (
  compatibilityRoot: string,
  entry: fs.Dirent
): Promise<ProtonVersion | null> => {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return null;

  const candidatePath = path.join(compatibilityRoot, entry.name);
  try {
    const realPath = await fs.promises.realpath(candidatePath);
    const targetStat = await fs.promises.stat(realPath);
    if (!targetStat.isDirectory() || !isValidNotProtonDirectory(realPath)) {
      return null;
    }

    return {
      name: getNotProtonToolName(realPath),
      path: realPath,
      source: "compatibility_tools",
    };
  } catch {
    return null;
  }
};

const readNotProtonToolsInRoot = async (
  compatibilityRoot: string
): Promise<ProtonVersion[]> => {
  if (!fs.existsSync(compatibilityRoot)) return [];

  const entries = await fs.promises
    .readdir(compatibilityRoot, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[]);

  const resolved = await Promise.all(
    entries.map((entry) => resolveNotProtonEntry(compatibilityRoot, entry))
  );
  return resolved.filter((tool): tool is ProtonVersion => tool !== null);
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

  const toolsPerRoot = await Promise.all(
    compatibilityRoots.map((root) => readNotProtonToolsInRoot(root))
  );

  const toolsByPath = new Map<string, ProtonVersion>();
  for (const tool of toolsPerRoot.flat()) {
    toolsByPath.set(tool.path, tool);
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

const ensureCustomCompatDataWrapper = (winePrefixPath: string): string => {
  const resolvedTarget = path.resolve(winePrefixPath);
  fs.mkdirSync(resolvedTarget, { recursive: true });

  const digest = crypto
    .createHash("sha256")
    .update(resolvedTarget)
    .digest("hex")
    .slice(0, COMPAT_WRAPPER_HASH_LENGTH);
  const compatDir = path.join(
    SystemPath.getPath("userData"),
    "wine-compat",
    digest
  );
  fs.mkdirSync(compatDir, { recursive: true });

  const pfxLinkPath = path.join(compatDir, "pfx");
  try {
    const existingStat = fs.lstatSync(pfxLinkPath);
    if (existingStat.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(pfxLinkPath);
      if (path.resolve(compatDir, currentTarget) === resolvedTarget) {
        return compatDir;
      }
      fs.unlinkSync(pfxLinkPath);
    } else if (existingStat.isDirectory()) {
      throw new Error(
        `Unexpected directory at macOS compatibility wrapper: ${pfxLinkPath}`
      );
    } else {
      fs.unlinkSync(pfxLinkPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }

  fs.symlinkSync(resolvedTarget, pfxLinkPath);
  return compatDir;
};

const resolveCompatDataPath = (
  winePrefixPath?: string | null,
  objectId?: string
): string => {
  if (winePrefixPath) {
    if (path.basename(winePrefixPath) === "pfx") {
      return path.dirname(winePrefixPath);
    }
    return ensureCustomCompatDataWrapper(winePrefixPath);
  }

  const safeId = (objectId || "default").replaceAll(/[^\w.-]/g, "_");
  return path.join(SystemPath.getPath("userData"), "wine-prefixes", safeId);
};

interface ResolvedNotProtonRunner {
  runnerPath: string;
  runScript: string;
}

const resolveReadyNotProtonRunner = async (
  protonPath?: string | null
): Promise<ResolvedNotProtonRunner> => {
  const status = await getMacCompatibilityStatus();
  if (!status.isReady) {
    throw new Error(NOTPROTON_REQUIRED_ERROR);
  }

  const runnerPath =
    protonPath && isValidNotProtonDirectory(protonPath)
      ? protonPath
      : status.notProtonTools[0]?.path;

  if (!runnerPath) {
    throw new Error(NOTPROTON_REQUIRED_ERROR);
  }

  const runScript = path.join(runnerPath, "run");
  try {
    const currentMode = fs.statSync(runScript).mode;
    if ((currentMode & 0o100) === 0) {
      fs.chmodSync(runScript, currentMode | 0o100);
    }
  } catch {
    // Ignore permission errors on read-only paths.
  }

  return { runnerPath, runScript };
};

const STEAM_APP_BUNDLE_MACOS_SEGMENTS = [
  "Steam.AppBundle",
  "Steam",
  "Contents",
  "MacOS",
] as const;

export const resolveMacSteamClientPath = (
  steamRoot?: string | null,
  home = SystemPath.getPath("home"),
  existsSync: (targetPath: string) => boolean = fs.existsSync
): { path: string; hasNativeLibrary: boolean } => {
  const defaultSteamRoot = path.join(
    home,
    "Library",
    "Application Support",
    "Steam"
  );
  const roots = [
    ...new Set([steamRoot, defaultSteamRoot].filter((v): v is string => !!v)),
  ];
  const candidates = [
    ...roots.map((root) => path.join(root, ...STEAM_APP_BUNDLE_MACOS_SEGMENTS)),
    "/Applications/Steam.app/Contents/MacOS",
    ...roots,
  ];

  const matched = candidates.find((candidate) =>
    existsSync(path.join(candidate, "steamclient.dylib"))
  );

  if (matched) {
    return { path: matched, hasNativeLibrary: true };
  }

  return {
    path: path.join(
      steamRoot ?? defaultSteamRoot,
      ...STEAM_APP_BUNDLE_MACOS_SEGMENTS
    ),
    hasNativeLibrary: false,
  };
};

const resolveDefaultSteamClientPath = async () => {
  const steamRoot = await getSteamLocation().catch(() => null);
  return resolveMacSteamClientPath(steamRoot);
};

const buildNotProtonEnvironment = (params: {
  compatDataPath: string;
  installPath: string;
  steamClientPath: string;
  objectId: string;
  extraEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv => ({
  ...process.env,
  STEAM_COMPAT_DATA_PATH: params.compatDataPath,
  STEAM_COMPAT_INSTALL_PATH: params.installPath,
  STEAM_COMPAT_CLIENT_INSTALL_PATH: params.steamClientPath,
  ...(/^\d+$/.test(params.objectId)
    ? { STEAM_COMPAT_APP_ID: params.objectId }
    : {}),
  ...params.extraEnv,
});

export interface PrepareMacWinePrefixOptions {
  winePrefixPath?: string | null;
  protonPath?: string | null;
  objectId: string;
}

export const prepareMacWinePrefix = async (
  options: PrepareMacWinePrefixOptions
): Promise<void> => {
  const { runScript } = await resolveReadyNotProtonRunner(options.protonPath);
  const compatDataPath = resolveCompatDataPath(
    options.winePrefixPath,
    options.objectId
  );
  fs.mkdirSync(compatDataPath, { recursive: true });

  const { path: steamClientPath } = await resolveDefaultSteamClientPath();
  const env = buildNotProtonEnvironment({
    compatDataPath,
    installPath: options.winePrefixPath ?? compatDataPath,
    steamClientPath,
    objectId: options.objectId,
  });

  await execFileAsync(runScript, ["runinprefix", "wineboot", "--update"], {
    cwd: compatDataPath,
    env,
    timeout: MAC_PREFIX_PREPARE_TIMEOUT_MS,
  });
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

export interface PreparedNotProtonLaunch {
  runnerPath: string;
  compatDataPath: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export const prepareNotProtonLaunch = async (
  options: LaunchMacWindowsOptions
): Promise<PreparedNotProtonLaunch> => {
  const { runnerPath, runScript } = await resolveReadyNotProtonRunner(
    options.protonPath
  );

  const compatDataPath = resolveCompatDataPath(
    options.winePrefixPath,
    options.objectId
  );
  fs.mkdirSync(compatDataPath, { recursive: true });

  const { path: steamClientPath, hasNativeLibrary } =
    await resolveDefaultSteamClientPath();

  const workingDirectory =
    options.workingDirectory ?? path.dirname(options.executablePath);
  const verb = hasNativeLibrary ? "waitforexitandrun" : "runinprefix";
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: runScript,
    baseArgs: [verb, options.executablePath, ...(options.shortcutArgs ?? [])],
    launchOptions: options.launchOptions,
  });

  const env = buildNotProtonEnvironment({
    compatDataPath,
    installPath: path.dirname(options.executablePath),
    steamClientPath,
    objectId: options.objectId,
    extraEnv: resolvedLaunchCommand.env,
  });

  return {
    runnerPath,
    compatDataPath,
    command: resolvedLaunchCommand.command,
    args: resolvedLaunchCommand.args,
    cwd: workingDirectory,
    env,
  };
};

export const launchWindowsExecutableWithNotProton = async (
  options: LaunchMacWindowsOptions
): Promise<number | null> => {
  const prepared = await prepareNotProtonLaunch(options);

  const safeObjectId = options.objectId.replaceAll(/[^\w.-]/g, "_");
  const logFilePath = path.join(logsPath, `notproton-${safeObjectId}.log`);
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  logger.info("Launching Windows executable via NotProton on macOS", {
    runnerPath: prepared.runnerPath,
    executablePath: options.executablePath,
    compatDataPath: prepared.compatDataPath,
    logFilePath,
  });

  const logFd = fs.openSync(logFilePath, "a");
  try {
    const child = spawn(prepared.command, prepared.args, {
      shell: false,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: prepared.cwd,
      env: prepared.env,
    });

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
