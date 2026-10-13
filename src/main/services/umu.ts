import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { SystemPath } from "./system-path";
import { logsPath } from "@main/constants";
import { logger } from "./logger";
import type { ProtonVersion } from "@types";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";
import { evaluateUmuPrefixPreparation } from "./umu-prefix-preparation";
import { Wine } from "./wine";
import { getSteamLibraryFolders } from "./steam";
import { UmuUpdater } from "./umu-updater";
import {
  UmuEarlyExitError,
  observeUmuLaunch,
  watchUmuSetup,
  type UmuStatusListener,
} from "./umu-launch-monitor";
import { getFileSize } from "./umu-output-monitor";

export type { UmuStatus } from "./umu-launch-monitor";

const isValidProtonDirectory = (directoryPath: string) => {
  const protonFilePath = path.join(directoryPath, "proton");
  const toolManifestPath = path.join(directoryPath, "toolmanifest.vdf");

  return fs.existsSync(protonFilePath) && fs.existsSync(toolManifestPath);
};

const getVersionName = (directoryPath: string) => {
  return path.basename(directoryPath);
};

const getSharedUmuLogPath = () => path.join(logsPath, "umu.log");

const getUmuLogPath = (gameId?: string | null) =>
  gameId
    ? path.join(logsPath, `umu-${gameId.replaceAll(/[^\w.-]/g, "_")}.log`)
    : getSharedUmuLogPath();

const appendUmuLogHeader = (umuLogPath: string, header: string) => {
  fs.appendFileSync(umuLogPath, header);
  const sharedLogPath = getSharedUmuLogPath();
  if (umuLogPath !== sharedLogPath) {
    fs.appendFileSync(
      sharedLogPath,
      `${header.trimEnd()}\nOutput: ${path.basename(umuLogPath)}\n`
    );
  }
};

const getBundledUmuBinaryPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "umu-run")
    : path.join(__dirname, "..", "..", "binaries", "umu", "umu-run");

const getUmuBinaryPath = () =>
  UmuUpdater.getManagedBinaryPath() ?? getBundledUmuBinaryPath();

const parsePythonVersion = (versionText: string): [number, number] | null => {
  const match = versionText.trim().match(/^(\d+)\.(\d+)$/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2])];
};

const hasSupportedPythonVersion = (version: [number, number]) => {
  const [major, minor] = version;
  return major > 3 || (major === 3 && minor >= 10);
};

const getCompatiblePythonPath = (): string | null => {
  const candidates = [
    process.env.HYDRA_UMU_PYTHON,
    "/usr/bin/python3",
    "python3",
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, arr) => arr.indexOf(value) === index);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(
        candidate,
        [
          "-c",
          "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')",
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
          shell: false,
        }
      );

      if (result.status !== 0) continue;

      const version = parsePythonVersion(result.stdout);
      if (!version || !hasSupportedPythonVersion(version)) continue;

      return candidate;
    } catch {
      continue;
    }
  }

  return null;
};

const ensureExecutablePermission = (binaryPath: string) => {
  if (process.platform === "win32") return;

  try {
    const currentMode = fs.statSync(binaryPath).mode;
    const hasAnyExecuteBit = (currentMode & 0o111) !== 0;

    if (!hasAnyExecuteBit) {
      fs.chmodSync(binaryPath, 0o755);
    }
  } catch (error) {
    logger.warn("Failed to ensure umu-run executable permission", {
      binaryPath,
      error,
    });
  }
};

const STEAM_ROOT_SEGMENTS = [
  [".steam", "steam"],
  [".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"],
  [".var", "app", "com.valvesoftware.Steam", "data", "Steam"],
  ["snap", "steam", "common", ".local", "share", "Steam"],
];

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class Umu {
  public static isValidProtonPath(protonPath: string) {
    return isValidProtonDirectory(protonPath);
  }

  public static async getInstalledProtonVersions(): Promise<ProtonVersion[]> {
    const homePath = SystemPath.getPath("home");
    const steamRoots = STEAM_ROOT_SEGMENTS.map((segments) =>
      path.join(homePath, ...segments)
    );
    const libraryFolders = await getSteamLibraryFolders().catch(() => []);

    const steamCommonPaths = [
      ...new Set(
        [...steamRoots, ...libraryFolders].map((root) =>
          path.join(root, "steamapps", "common")
        )
      ),
    ];
    const compatibilityToolPaths = [
      ...steamRoots.map((root) => path.join(root, "compatibilitytools.d")),
      path.join("/usr", "share", "steam", "compatibilitytools.d"),
    ];

    const versions: ProtonVersion[] = [];

    for (const steamCommonPath of steamCommonPaths) {
      if (!fs.existsSync(steamCommonPath)) {
        continue;
      }

      const steamCommonEntries = await fs.promises
        .readdir(steamCommonPath, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);

      for (const entry of steamCommonEntries) {
        if (!entry.isDirectory() || !entry.name.startsWith("Proton")) {
          continue;
        }

        const candidatePath = path.join(steamCommonPath, entry.name);

        if (!isValidProtonDirectory(candidatePath)) {
          continue;
        }

        const realPath = await fs.promises.realpath(candidatePath);

        versions.push({
          name: getVersionName(realPath),
          path: realPath,
          source: "steam",
        });
      }
    }

    for (const compatibilityToolPath of compatibilityToolPaths) {
      if (!fs.existsSync(compatibilityToolPath)) {
        continue;
      }

      const compatibilityToolEntries = await fs.promises
        .readdir(compatibilityToolPath, { withFileTypes: true })
        .catch(() => [] as fs.Dirent[]);

      for (const entry of compatibilityToolEntries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const candidatePath = path.join(compatibilityToolPath, entry.name);

        if (!isValidProtonDirectory(candidatePath)) {
          continue;
        }

        const realPath = await fs.promises.realpath(candidatePath);

        versions.push({
          name: getVersionName(realPath),
          path: realPath,
          source: "compatibility_tools",
        });
      }
    }

    const uniqueVersions = new Map<string, ProtonVersion>();

    for (const version of versions) {
      uniqueVersions.set(version.path, version);
    }

    return Array.from(uniqueVersions.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  public static async preparePrefix(options: {
    winePrefixPath: string;
    protonPath?: string | null;
    gameId?: string | null;
    onStatus?: UmuStatusListener;
  }): Promise<void> {
    const umuLogPath = getUmuLogPath(options.gameId);
    const umuBinaryPath = getUmuBinaryPath();
    const pythonPath = getCompatiblePythonPath();
    const command = pythonPath ?? umuBinaryPath;
    const args = pythonPath
      ? [umuBinaryPath, "createprefix"]
      : ["createprefix"];
    const launchEnv = {
      PROTON_LOG: "1",
      WINEPREFIX: options.winePrefixPath,
      ...(options.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(options.protonPath ? { PROTONPATH: options.protonPath } : {}),
    };

    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    fs.mkdirSync(path.dirname(options.winePrefixPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);
    appendUmuLogHeader(
      umuLogPath,
      `\n[${new Date().toISOString()}] Preparing Wine prefix with umu-run\n`
    );

    logger.info("Preparing Wine prefix with umu-run", {
      command,
      args,
      env: launchEnv,
      umuLogPath,
    });

    await new Promise<void>((resolve, reject) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(umuLogPath, "a");
      let settled = false;
      const setupWatcher = watchUmuSetup(
        shouldPipeToTerminal ? null : umuLogPath,
        options.onStatus
      );

      const closeLogFileDescriptor = () => {
        if (!settled && logFileDescriptor !== null) {
          fs.closeSync(logFileDescriptor);
        }
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        closeLogFileDescriptor();
        settled = true;
        callback();
      };
      const child = spawn(command, args, {
        detached: false,
        stdio: shouldPipeToTerminal
          ? "inherit"
          : ["ignore", logFileDescriptor, logFileDescriptor],
        shell: false,
        cwd: SystemPath.getPath("home"),
        env: {
          ...process.env,
          ...launchEnv,
        },
      });

      child.once("error", (error) => {
        setupWatcher.complete();
        finish(() => {
          logger.error("Failed to start umu-run prefix preparation", {
            errorName: error.name,
            errorMessage: error.message,
            umuLogPath,
          });
          reject(error);
        });
      });
      child.once("close", (code, signal) => {
        const setup = setupWatcher.complete();
        finish(() => {
          let prefixValid = false;

          try {
            prefixValid = Wine.validatePrefix(options.winePrefixPath);
          } catch {
            prefixValid = false;
          }

          const evaluation = evaluateUmuPrefixPreparation(
            code,
            signal,
            prefixValid
          );
          if (evaluation.success) {
            if (evaluation.acceptedNonZeroExit) {
              logger.warn(
                "umu-run returned a non-zero exit after preparing a valid prefix",
                {
                  code,
                  signal,
                  prefixValid,
                  umuLogPath,
                }
              );
            }
            resolve();
            return;
          }

          const errorMessage = setup.failureMessage
            ? `${evaluation.errorMessage}: ${setup.failureMessage}`
            : evaluation.errorMessage;
          logger.error("umu-run failed to prepare a valid Wine prefix", {
            code,
            signal,
            prefixValid,
            umuLogPath,
            errorMessage,
          });
          reject(new Error(errorMessage));
        });
      });
    });
  }

  public static async launchExecutable(
    executablePath: string,
    launchParameters: string[] = [],
    options?: {
      winePrefixPath?: string | null;
      protonPath?: string | null;
      gameId?: string | null;
      launchOptions?: string | null;
      useMangohud?: boolean;
      useGamemode?: boolean;
      onStatus?: UmuStatusListener;
      wasGameDetected?: () => boolean;
    }
  ): Promise<void> {
    const QUICK_EXIT_THRESHOLD_MS = 3000;
    const workingDirectory = path.dirname(executablePath);
    const umuLogPath = getUmuLogPath(options?.gameId);
    const umuBinaryPath = getUmuBinaryPath();
    const pythonPath = getCompatiblePythonPath();
    const executableToSpawn = pythonPath ?? umuBinaryPath;
    const executableArgs = pythonPath
      ? [umuBinaryPath, executablePath, ...launchParameters]
      : [executablePath, ...launchParameters];
    const resolvedLaunchCommand = resolveLaunchCommand({
      baseCommand: executableToSpawn,
      baseArgs: executableArgs,
      launchOptions: options?.launchOptions,
      wrapperCommands: [...(options?.useGamemode ? ["gamemoderun"] : [])],
    });

    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);

    const launchEnv = {
      PROTON_LOG: "1",
      ...(options?.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(options?.winePrefixPath
        ? { WINEPREFIX: options.winePrefixPath }
        : {}),
      ...(options?.protonPath ? { PROTONPATH: options.protonPath } : {}),
      ...(options?.useMangohud ? { MANGOHUD: "1" } : {}),
      ...resolvedLaunchCommand.env,
    };

    const envCommandPart = Object.entries(launchEnv)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const argsCommandPart = resolvedLaunchCommand.args
      .map(shellQuote)
      .join(" ");
    const launchCommand = `${envCommandPart} ${shellQuote(resolvedLaunchCommand.command)}${
      argsCommandPart ? ` ${argsCommandPart}` : ""
    }`;

    const launchHeader =
      `\n[${new Date().toISOString()}] Launching with umu-run\n` +
      `Command: ${launchCommand}\n`;

    appendUmuLogHeader(umuLogPath, launchHeader);

    logger.info("Launching game with umu-run", {
      command: launchCommand,
      umuBinaryPath,
      pythonPath,
      cwd: workingDirectory,
      env: launchEnv,
      umuLogPath,
    });

    const shouldPipeToTerminal = is.dev;
    const logStartOffset = getFileSize(umuLogPath);
    const logFileDescriptor = shouldPipeToTerminal
      ? null
      : fs.openSync(umuLogPath, "a");

    try {
      const child = spawn(
        resolvedLaunchCommand.command,
        resolvedLaunchCommand.args,
        {
          detached: true,
          stdio: shouldPipeToTerminal
            ? "inherit"
            : ["ignore", logFileDescriptor, logFileDescriptor],
          shell: false,
          cwd: workingDirectory,
          env: {
            ...process.env,
            ...launchEnv,
          },
        }
      );

      await observeUmuLaunch({
        child,
        umuLogPath: shouldPipeToTerminal ? null : umuLogPath,
        logStartOffset,
        quickExitThresholdMs: QUICK_EXIT_THRESHOLD_MS,
        onStatus: options?.onStatus,
        wasGameDetected: options?.wasGameDetected,
        onLateFailure: (failure) =>
          logger.error("umu-run failed after the game launch started", {
            ...failure,
            umuLogPath,
          }),
      });
      child.unref();
    } catch (error) {
      const logLine =
        error instanceof UmuEarlyExitError
          ? error.message
          : `Failed to spawn umu-run (${resolvedLaunchCommand.command}): ${String(error)}`;
      fs.appendFileSync(
        umuLogPath,
        `[${new Date().toISOString()}] ${logLine}\n`
      );
      throw error;
    } finally {
      if (logFileDescriptor !== null) fs.closeSync(logFileDescriptor);
    }
  }
}
