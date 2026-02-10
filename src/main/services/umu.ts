import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { SystemPath } from "./system-path";
import { logsPath } from "@main/constants";
import { logger } from "./logger";
import { Wine } from "./wine";
import type { ProtonVersion } from "@types";
import { resolveLaunchCommand } from "@main/helpers/resolve-launch-command";

const isValidProtonDirectory = (directoryPath: string) => {
  const protonFilePath = path.join(directoryPath, "proton");
  const toolManifestPath = path.join(directoryPath, "toolmanifest.vdf");

  return fs.existsSync(protonFilePath) && fs.existsSync(toolManifestPath);
};

const getVersionName = (directoryPath: string) => {
  return path.basename(directoryPath);
};

const getUmuLogPath = () => path.join(logsPath, "umu.log");

const getUmuBinaryPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "umu-run")
    : path.join(__dirname, "..", "..", "binaries", "umu", "umu-run");

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

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class Umu {
  public static isValidProtonPath(protonPath: string) {
    return isValidProtonDirectory(protonPath);
  }

  public static async getInstalledProtonVersions(): Promise<ProtonVersion[]> {
    const homePath = SystemPath.getPath("home");

    const steamCommonPath = path.join(
      homePath,
      ".steam",
      "steam",
      "steamapps",
      "common"
    );
    const compatibilityToolsPath = path.join(
      homePath,
      ".steam",
      "steam",
      "compatibilitytools.d"
    );
    const systemCompatibilityToolsPath = path.join(
      "/usr",
      "share",
      "steam",
      "compatibilitytools.d"
    );

    const versions: ProtonVersion[] = [];

    if (fs.existsSync(steamCommonPath)) {
      const steamCommonEntries = await fs.promises.readdir(steamCommonPath, {
        withFileTypes: true,
      });

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

    const compatibilityToolPaths = [
      compatibilityToolsPath,
      systemCompatibilityToolsPath,
    ];

    for (const compatibilityToolPath of compatibilityToolPaths) {
      if (!fs.existsSync(compatibilityToolPath)) {
        continue;
      }

      const compatibilityToolEntries = await fs.promises.readdir(
        compatibilityToolPath,
        {
          withFileTypes: true,
        }
      );

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

  public static async launchExecutable(
    executablePath: string,
    launchParameters: string[] = [],
    options?: {
      winePrefixPath?: string | null;
      protonPath?: string | null;
      gameId?: string | null;
      launchOptions?: string | null;
      useMangohud?: boolean;
    }
  ): Promise<void> {
    const umuLogPath = getUmuLogPath();
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
      wrapperCommand: options?.useMangohud ? "mangohud" : null,
    });
    const winePrefixPath = Wine.getEffectivePrefixPath(options?.winePrefixPath);

    fs.mkdirSync(path.dirname(umuLogPath), { recursive: true });
    ensureExecutablePermission(umuBinaryPath);

    const launchEnv = {
      PROTON_LOG: "1",
      ...(options?.gameId ? { GAMEID: `umu-${options.gameId}` } : {}),
      ...(winePrefixPath ? { WINEPREFIX: winePrefixPath } : {}),
      ...(options?.protonPath ? { PROTONPATH: options.protonPath } : {}),
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

    fs.appendFileSync(umuLogPath, launchHeader);

    logger.info("Launching game with umu-run", {
      command: launchCommand,
      umuBinaryPath,
      pythonPath,
      env: launchEnv,
      umuLogPath,
    });

    await new Promise<void>((resolve, reject) => {
      const shouldPipeToTerminal = is.dev;
      const logFileDescriptor = shouldPipeToTerminal
        ? null
        : fs.openSync(umuLogPath, "a");

      const child = spawn(
        resolvedLaunchCommand.command,
        resolvedLaunchCommand.args,
        {
          detached: true,
          stdio: shouldPipeToTerminal
            ? "inherit"
            : ["ignore", logFileDescriptor, logFileDescriptor],
          shell: false,
          env: {
            ...process.env,
            ...launchEnv,
          },
        }
      );

      child.once("spawn", () => {
        child.unref();
        if (logFileDescriptor !== null) {
          fs.closeSync(logFileDescriptor);
        }
        resolve();
      });

      child.once("error", (error) => {
        if (logFileDescriptor !== null) {
          fs.closeSync(logFileDescriptor);
        }
        fs.appendFileSync(
          umuLogPath,
          `[${new Date().toISOString()}] Failed to spawn umu-run (${resolvedLaunchCommand.command}): ${String(error)}\n`
        );
        reject(error);
      });
    });
  }
}
