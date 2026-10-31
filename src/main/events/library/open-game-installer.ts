import { shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { registerEvent } from "../register-event";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import type { Download, GameShop } from "@types";
import {
  GameFilesManager,
  logger,
  Umu,
  Wine,
  WindowManager,
} from "@main/services";
import { UmuEarlyExitError } from "@main/services/umu-launch-monitor";
import {
  findDownloadInstaller,
  getDownloadFolderPath,
} from "@main/helpers/find-game-installer";
import {
  endInstallerRun,
  markInstallerRunLive,
  startInstalledExecutablePolling,
  stopInstalledExecutablePolling,
} from "@main/helpers/installed-executable-poller";

interface InstallerLaunchOptions {
  gameId?: string;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  onExit: (exitCode: number | null) => void;
  onCancel: () => void;
  onUntrackedLaunch: () => void;
}

interface InstallerLaunchResult {
  launched: boolean;
  tracked: boolean;
}

const UAC_DECLINED_EXIT_CODE = 1223;
const SUCCESS_EXIT_CODES = new Set([0, 1641, 3010]);
const INSTALLER_STARTED_MARKER = "HYDRA_INSTALLER_STARTED";
const INSTALLER_EXIT_MARKER = "HYDRA_INSTALLER_EXIT=";

const QUICK_INSTALLER_EXIT_MS = 15_000;
const MAX_INSTALLER_TRACKING_MS = 2 * 60 * 60_000;
const ELEVATION_ERROR_CODES = new Set(["EACCES", "UNKNOWN"]);

const runningInstallers = new Map<string, number>();

const releaseRunningInstaller = (
  gameKey: string,
  installerStartedAt: number
) => {
  if (runningInstallers.get(gameKey) === installerStartedAt) {
    runningInstallers.delete(gameKey);
  }
};

const isSuccessfulExit = (exitCode: number | null) =>
  exitCode !== null && SUCCESS_EXIT_CODES.has(exitCode);

const ELEVATED_INSTALLER_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "$info = New-Object System.Diagnostics.ProcessStartInfo",
  "$info.FileName = $env:HYDRA_INSTALLER_PATH",
  "$info.WorkingDirectory = [System.IO.Path]::GetDirectoryName($env:HYDRA_INSTALLER_PATH)",
  "$info.Verb = 'runas'",
  "$info.UseShellExecute = $true",
  "$installer = [System.Diagnostics.Process]::Start($info)",
  `Write-Output '${INSTALLER_STARTED_MARKER}'`,
  `if ($installer) { $installer.WaitForExit(); Write-Output ('${INSTALLER_EXIT_MARKER}' + $installer.ExitCode) }`,
  "} catch {",
  "$failure = $_.Exception.GetBaseException()",
  `if ($failure.NativeErrorCode -eq ${UAC_DECLINED_EXIT_CODE}) { Write-Output '${INSTALLER_EXIT_MARKER}${UAC_DECLINED_EXIT_CODE}' } else { Write-Output $failure.Message }`,
  "}",
].join("; ");

interface SpawnInstallerResult {
  spawned: boolean;
  errorCode: string | null;
}

interface SpawnInstallerConfig {
  command: string;
  args: string[];
  failureMessage: string;
  onExit: (code: number | null, output: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  captureOutput?: boolean;
}

const spawnInstaller = async ({
  command,
  args,
  failureMessage,
  onExit,
  env,
  cwd,
  captureOutput = false,
}: SpawnInstallerConfig): Promise<SpawnInstallerResult> => {
  return await new Promise<SpawnInstallerResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    let output = "";

    try {
      child = spawn(command, args, {
        detached: !captureOutput,
        stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
        shell: false,
        windowsHide: captureOutput,
        env: env ?? process.env,
        cwd,
      });
    } catch (error) {
      logger.error(failureMessage, error);
      resolve({
        spawned: false,
        errorCode: (error as NodeJS.ErrnoException).code ?? null,
      });
      return;
    }

    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", appendOutput);
    child.stderr?.on("data", appendOutput);

    child.once("spawn", () => {
      child.once("close", (code) => onExit(code, output.trim()));
      if (!captureOutput) child.unref();
      resolve({ spawned: true, errorCode: null });
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      logger.error(failureMessage, error);
      resolve({ spawned: false, errorCode: error.code ?? null });
    });
  });
};

const openPathAndCheck = async (filePath: string): Promise<boolean> => {
  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const readOutputLines = (output: string) => output.split(/\r?\n/);

const readInstallerExitCode = (output: string) => {
  const markerLine = readOutputLines(output).find((line) =>
    line.startsWith(INSTALLER_EXIT_MARKER)
  );

  return markerLine
    ? Number(markerLine.slice(INSTALLER_EXIT_MARKER.length))
    : null;
};

const handleElevatedInstallerExit = async (
  code: number | null,
  output: string,
  filePath: string,
  options: InstallerLaunchOptions
) => {
  logger.info(
    `[GameInstaller] PowerShell exited with code ${code}: ${output || "no output"}`
  );

  const installerExitCode = readInstallerExitCode(output);
  if (installerExitCode !== null) return options.onExit(installerExitCode);

  if (readOutputLines(output).includes(INSTALLER_STARTED_MARKER)) {
    logger.info(
      `[GameInstaller] Started ${filePath} with elevation but could not wait for it`
    );
    return options.onUntrackedLaunch();
  }

  logger.error("Failed to launch game installer with elevation");

  if (await openPathAndCheck(filePath)) {
    logger.info(`[GameInstaller] Opened ${filePath} untracked`);
    return options.onUntrackedLaunch();
  }

  logger.error(`[GameInstaller] Could not open ${filePath}`);
  options.onCancel();
};

const launchInstallerElevated = async (
  filePath: string,
  options: InstallerLaunchOptions
) =>
  spawnInstaller({
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      ELEVATED_INSTALLER_COMMAND,
    ],
    failureMessage: "Failed to execute game installer with elevation",
    onExit: (code, output) =>
      void handleElevatedInstallerExit(code, output, filePath, options).catch(
        (error) => {
          logger.error("Failed to handle the elevated installer exit", error);
        }
      ),
    env: { ...process.env, HYDRA_INSTALLER_PATH: filePath },
    captureOutput: true,
  });

const launchInstallerWithUmu = async (
  filePath: string,
  options: InstallerLaunchOptions
) => {
  let launched = false;

  try {
    await Umu.launchExecutable(filePath, [], {
      gameId: options.gameId,
      winePrefixPath: options.winePrefixPath,
      protonPath: options.protonPath,
      onExit: (exitCode) => {
        if (launched) options.onExit(exitCode);
      },
    });
  } catch (error) {
    if (!(error instanceof UmuEarlyExitError) || error.failureMessage) {
      throw error;
    }

    logger.info(
      `[GameInstaller] Installer exited early under umu-run: ${error.message}`
    );
    options.onExit(error.code);
    return;
  }

  launched = true;
};

const trackedLaunch = (
  filePath: string,
  method: string
): InstallerLaunchResult => {
  logger.info(`[GameInstaller] Launched ${filePath} ${method}`);
  return { launched: true, tracked: true };
};

const openUntracked = async (
  filePath: string
): Promise<InstallerLaunchResult> => {
  const launched = await openPathAndCheck(filePath);

  if (launched) logger.info(`[GameInstaller] Opened ${filePath} untracked`);
  else logger.error(`[GameInstaller] Could not open ${filePath}`);

  return { launched, tracked: false };
};

const executeWindowsInstaller = async (
  filePath: string,
  options: InstallerLaunchOptions
): Promise<InstallerLaunchResult> => {
  const direct = await spawnInstaller({
    command: filePath,
    args: [],
    cwd: path.dirname(filePath),
    failureMessage: "Failed to execute game installer directly",
    onExit: options.onExit,
  });
  if (direct.spawned) return trackedLaunch(filePath, "directly");

  if (direct.errorCode && ELEVATION_ERROR_CODES.has(direct.errorCode)) {
    const elevated = await launchInstallerElevated(filePath, options);
    if (elevated.spawned) return trackedLaunch(filePath, "with elevation");
  }

  return await openUntracked(filePath);
};

const executeLinuxInstaller = async (
  filePath: string,
  options: InstallerLaunchOptions
): Promise<InstallerLaunchResult> => {
  try {
    await launchInstallerWithUmu(filePath, options);
    return trackedLaunch(filePath, "with umu-run");
  } catch (error) {
    logger.error("Failed to execute game installer with umu-run", error);
  }

  const wine = await spawnInstaller({
    command: "wine",
    args: [filePath],
    cwd: path.dirname(filePath),
    env: options.winePrefixPath
      ? { ...process.env, WINEPREFIX: options.winePrefixPath }
      : undefined,
    failureMessage: "Failed to execute game installer with wine",
    onExit: options.onExit,
  });
  if (wine.spawned) return trackedLaunch(filePath, "with wine");

  return await openUntracked(filePath);
};

const executeGameInstaller = async (
  filePath: string,
  options: InstallerLaunchOptions
): Promise<InstallerLaunchResult> => {
  if (process.platform === "win32") {
    return await executeWindowsInstaller(filePath, options);
  }

  if (process.platform === "linux") {
    return await executeLinuxInstaller(filePath, options);
  }

  return await openUntracked(filePath);
};

const describeInstallerExit = (exitCode: number | null) => {
  if (exitCode === 0) return "completed";
  if (isSuccessfulExit(exitCode)) {
    return `completed and asked for a restart (exit code ${exitCode})`;
  }
  if (exitCode === UAC_DECLINED_EXIT_CODE) return "UAC prompt declined";
  if (exitCode === null) return "terminated without an exit code";
  return `cancelled or failed with exit code ${exitCode}`;
};

const updateInstallerState = async (
  gameKey: string,
  state: Pick<
    Download,
    | "installerLaunched"
    | "installerRunning"
    | "installerStartedAt"
    | "installerPath"
  >
) => {
  const download = await downloadsSublevel.get(gameKey);
  if (!download) return;

  await downloadsSublevel.put(gameKey, { ...download, ...state });
  WindowManager.sendDownloadsUpdated();
};

const handleInstallerExit = async (
  shop: GameShop,
  objectId: string,
  installerStartedAt: number,
  winePrefixPath: string | null,
  exitCode: number | null
) => {
  logger.info(
    `[GameInstaller] Installer for ${objectId} ${describeInstallerExit(exitCode)}`
  );

  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);

  if (download?.installerStartedAt !== installerStartedAt) {
    logger.info(
      `[GameInstaller] Ignoring the exit of an older installer run for ${objectId}`
    );
    return;
  }

  stopInstalledExecutablePolling(gameKey);

  if (!isSuccessfulExit(exitCode)) {
    logger.info(`[GameInstaller] Reset ${objectId} back to Install`);
    await updateInstallerState(gameKey, {
      installerRunning: false,
      installerLaunched: false,
    });
    return;
  }

  const executableFound = await new GameFilesManager(
    shop,
    objectId
  ).searchAndBindInstalledExecutable(installerStartedAt, winePrefixPath);

  const exitedQuickly =
    Date.now() - installerStartedAt < QUICK_INSTALLER_EXIT_MS;

  logger.info(
    executableFound
      ? `[GameInstaller] Found the installed executable for ${objectId}`
      : `[GameInstaller] No installed executable found for ${objectId} yet, polling for it`
  );

  await updateInstallerState(gameKey, { installerRunning: false });

  if (!executableFound) {
    startInstalledExecutablePolling(
      shop,
      objectId,
      installerStartedAt,
      winePrefixPath
    );
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  if (!executableFound && exitedQuickly) return;

  WindowManager.sendToAppWindows(
    "on-game-installer-closed",
    shop,
    objectId,
    executableFound
  );
};

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  const gamePath = download ? await getDownloadFolderPath(download) : null;

  if (!gamePath || !fs.existsSync(gamePath)) {
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  if (runningInstallers.has(gameKey) || download?.installerRunning) {
    logger.info(`[GameInstaller] Installer for ${objectId} is already running`);
    return true;
  }

  const installerStartedAt = Date.now();
  runningInstallers.set(gameKey, installerStartedAt);
  stopInstalledExecutablePolling(gameKey);

  const installerPath = await findDownloadInstaller(download).catch(() => null);

  if (!installerPath) {
    releaseRunningInstaller(gameKey, installerStartedAt);
    shell.openPath(gamePath);
    return true;
  }

  let installerFinished = false;
  let trackingTimeout: NodeJS.Timeout | null = null;
  let markLaunchRecorded = () => {};
  const launchRecorded = new Promise<void>((resolve) => {
    markLaunchRecorded = resolve;
  });

  const afterLaunchRecorded = (callback: () => Promise<void>) => {
    if (installerFinished) return;
    installerFinished = true;
    if (trackingTimeout) clearTimeout(trackingTimeout);
    releaseRunningInstaller(gameKey, installerStartedAt);
    endInstallerRun(gameKey, installerStartedAt);
    void launchRecorded.then(callback).catch((error) => {
      logger.error("Failed to update the installer state", error);
    });
  };

  const launchResult = await executeGameInstaller(installerPath, {
    gameId: objectId,
    winePrefixPath,
    protonPath: game?.protonPath,
    onExit: (exitCode) =>
      afterLaunchRecorded(() =>
        handleInstallerExit(
          shop,
          objectId,
          installerStartedAt,
          winePrefixPath,
          exitCode
        )
      ),
    onCancel: () =>
      afterLaunchRecorded(() =>
        updateInstallerState(gameKey, {
          installerLaunched: false,
          installerRunning: false,
        })
      ),
    onUntrackedLaunch: () =>
      afterLaunchRecorded(() =>
        updateInstallerState(gameKey, {
          installerLaunched: true,
          installerRunning: false,
        })
      ),
  }).catch((error) => {
    releaseRunningInstaller(gameKey, installerStartedAt);
    markLaunchRecorded();
    throw error;
  });
  const { launched, tracked } = launchResult;

  if (!launched || !tracked)
    releaseRunningInstaller(gameKey, installerStartedAt);

  if (launched && tracked && !installerFinished) {
    markInstallerRunLive(gameKey, installerStartedAt);
    trackingTimeout = setTimeout(() => {
      if (installerFinished) return;

      logger.info(
        `[GameInstaller] Installer for ${objectId} is still open after two hours, allowing it to be relaunched`
      );
      releaseRunningInstaller(gameKey, installerStartedAt);
      void launchRecorded
        .then(() => updateInstallerState(gameKey, { installerRunning: false }))
        .catch((error) => {
          logger.error("Failed to update the installer state", error);
        });
    }, MAX_INSTALLER_TRACKING_MS);
    trackingTimeout.unref();
  }

  try {
    if (launched) {
      await updateInstallerState(gameKey, {
        installerLaunched: true,
        installerRunning: tracked && !installerFinished,
        installerStartedAt,
        installerPath,
      });
    }
  } finally {
    markLaunchRecorded();
  }

  return launched;
};

registerEvent("openGameInstaller", openGameInstaller);
