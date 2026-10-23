import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EmulatorBinary, EmulatorSystem } from "@types";

import { logger } from "../../logger";
import { NativeAddon } from "../../native-addon";
import { getAllEmulatorConfigs } from "../../emulators/emulators-repository";
import { getRetroArchConfig } from "../../retroarch/retroarch-repository";
import { resolveEmulatorExecutableTarget } from "../../emulators/macos-app-bundle";
import { KNOWN_BINARIES } from "../../emulators/known-binaries";
import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "../../emulators/emulator-config";
import { ppssppConfigCandidates } from "../../emulators/ppsspp-paths";
import { dolphinUserDirectoryCandidates } from "../../emulators/emulator-log-paths";
import { retroArchConfigCandidates } from "../../retroarch/retroarch-config-paths";
import type { EmulatorSessionSystem } from "../../emulators/emulator-session-tracker";
import {
  loadRetroAchievementsEmulatorAccount,
  type RetroAchievementsEmulatorAccount,
} from "../retro-achievements-emulator-account";
import {
  getIniValue,
  readDolphinAccount,
  readPcsx2Account,
  readPpssppUsername,
  readRetroArchAccount,
  shouldWriteEmulatorAccount,
  writeDolphinAccount,
  writePcsx2Account,
  writePcsx2Token,
  writePpssppUsername,
  writeRetroArchAccount,
} from "./emulator-credential-config";

export type CredentialEmulator = "retroarch" | "pcsx2" | "ppsspp" | "dolphin";

interface CredentialTarget {
  emulator: CredentialEmulator;
  executablePath: string | null;
}

interface CredentialHandler {
  apply: (
    executablePath: string | null,
    account: RetroAchievementsEmulatorAccount
  ) => Promise<string | null>;
}

const BINARY_TO_EMULATOR: Partial<Record<EmulatorBinary, CredentialEmulator>> =
  {
    pcsx2: "pcsx2",
    ppsspp: "ppsspp",
    dolphin: "dolphin",
  };

const SYSTEM_TO_EMULATOR: Partial<
  Record<EmulatorSessionSystem, CredentialEmulator | null>
> = {
  ps1: null,
  ps2: "pcsx2",
  ps3: null,
  psp: "ppsspp",
  dolphin: "dolphin",
};

export const getCredentialEmulatorForSystem = (
  system: EmulatorSessionSystem
): CredentialEmulator | null =>
  system in SYSTEM_TO_EMULATOR
    ? (SYSTEM_TO_EMULATOR[system] ?? null)
    : "retroarch";

const CREDENTIAL_EMULATORS: CredentialEmulator[] = [
  "retroarch",
  "pcsx2",
  "ppsspp",
  "dolphin",
];

const knownExecutableNames = (system: EmulatorSystem) => [
  ...KNOWN_BINARIES[system].windowsNames,
  ...KNOWN_BINARIES[system].linuxNames,
];

const EMULATOR_PROCESS_NAMES: Record<CredentialEmulator, string[]> = {
  retroarch: ["retroarch.exe", "retroarch"],
  pcsx2: knownExecutableNames("ps2"),
  ppsspp: knownExecutableNames("psp"),
  dolphin: knownExecutableNames("dolphin"),
};

const absolutePaths = (paths: string[]) =>
  paths.filter((candidate) => path.isAbsolute(candidate));

const readText = (filePath: string) =>
  fs.promises.readFile(filePath, "utf8").catch(() => null);

const readTextOrEmptyIfMissing = (filePath: string) =>
  fs.promises
    .readFile(filePath, "utf8")
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? "" : null
    );

const CREDENTIAL_FILE_MODE = 0o600;

const writeIfChanged = async (
  filePath: string,
  original: string,
  updated: string,
  mode?: number
) => {
  if (updated === original) return;
  await fs.promises.writeFile(filePath, updated, { encoding: "utf8", mode });
};

const unixTimestamp = () => Math.floor(Date.now() / 1000);

const DOLPHIN_FLATPAK_CONFIG_DIRECTORY = path.join(
  os.homedir(),
  ".var",
  "app",
  "org.DolphinEmu.dolphin-emu",
  "config",
  "dolphin-emu"
);

const dolphinConfigDirectoryCandidates = (executablePath: string | null) => {
  const userConfigDirectories = absolutePaths(
    dolphinUserDirectoryCandidates(executablePath ?? "")
  ).map((userDirectory) => path.join(userDirectory, "Config"));

  if (process.platform !== "linux") return userConfigDirectories;

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const xdgConfigDirectory = path.join(
    xdgConfigHome && path.isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : path.join(os.homedir(), ".config"),
    "dolphin-emu"
  );

  return executablePath?.includes("org.DolphinEmu.dolphin-emu")
    ? [DOLPHIN_FLATPAK_CONFIG_DIRECTORY, ...userConfigDirectories]
    : [
        ...userConfigDirectories,
        xdgConfigDirectory,
        DOLPHIN_FLATPAK_CONFIG_DIRECTORY,
      ];
};

const resolveDolphinConfig = (executablePath: string | null) => {
  for (const configDirectory of dolphinConfigDirectoryCandidates(
    executablePath
  )) {
    if (fs.existsSync(path.join(configDirectory, "Dolphin.ini"))) {
      return path.join(configDirectory, "RetroAchievements.ini");
    }
  }

  return null;
};

const RETROARCH_FLATPAK_CONFIG = path.join(
  os.homedir(),
  ".var",
  "app",
  "org.libretro.RetroArch",
  "config",
  "retroarch",
  "retroarch.cfg"
);

const retroArchCredentialConfigCandidates = (executablePath: string | null) => {
  const candidates = absolutePaths(
    retroArchConfigCandidates(executablePath ?? "")
  );

  return !executablePath && process.platform === "linux"
    ? [...candidates, RETROARCH_FLATPAK_CONFIG]
    : candidates;
};

const ppssppTokenPath = (configPath: string) =>
  path.join(path.dirname(configPath), "ppsspp_retroachievements.dat");

const pcsx2SecretsPath = (configPath: string) =>
  path.join(path.dirname(configPath), "secrets.ini");

const HANDLERS: Record<CredentialEmulator, CredentialHandler> = {
  retroarch: {
    apply: async (executablePath, account) => {
      const configPath = findExistingConfig(
        retroArchCredentialConfigCandidates(executablePath)
      );
      if (!configPath) return null;

      const content = await readText(configPath);
      if (content === null) return null;
      if (
        !shouldWriteEmulatorAccount(
          readRetroArchAccount(content),
          account.username
        )
      ) {
        return null;
      }

      await writeIfChanged(
        configPath,
        content,
        writeRetroArchAccount(content, account.username, account.token)
      );
      return configPath;
    },
  },
  pcsx2: {
    apply: async (executablePath, account) => {
      const configPath = findExistingConfig(
        pcsx2ConfigCandidates(executablePath)
      );
      if (!configPath) return null;

      const content = await readText(configPath);
      if (content === null) return null;

      const secretsPath = pcsx2SecretsPath(configPath);
      const secretsContent = await readText(secretsPath);
      if (
        !shouldWriteEmulatorAccount(
          readPcsx2Account(content, secretsContent),
          account.username
        )
      ) {
        return null;
      }

      if (secretsContent === null) {
        await writeIfChanged(
          configPath,
          content,
          writePcsx2Token(
            writePcsx2Account(content, account.username, unixTimestamp()),
            account.token
          )
        );
      } else {
        const updatedSecrets = writePcsx2Token(secretsContent, account.token);
        await writeIfChanged(secretsPath, secretsContent, updatedSecrets);

        try {
          await writeIfChanged(
            configPath,
            content,
            writePcsx2Account(content, account.username, unixTimestamp())
          );
        } catch (error) {
          await writeIfChanged(secretsPath, updatedSecrets, secretsContent);
          throw error;
        }
      }

      return configPath;
    },
  },
  ppsspp: {
    apply: async (executablePath, account) => {
      const configPath = findExistingConfig(
        absolutePaths(ppssppConfigCandidates(executablePath ?? ""))
      );
      if (!configPath) return null;

      const content = await readText(configPath);
      if (content === null) return null;

      const tokenPath = ppssppTokenPath(configPath);
      const existingToken = await readTextOrEmptyIfMissing(tokenPath);
      if (existingToken === null) return null;
      if (
        !shouldWriteEmulatorAccount(
          {
            username: readPpssppUsername(content),
            hasToken: Boolean(existingToken),
          },
          account.username
        )
      ) {
        return null;
      }

      await fs.promises.writeFile(tokenPath, account.token, {
        encoding: "utf8",
        mode: CREDENTIAL_FILE_MODE,
      });

      try {
        await writeIfChanged(
          configPath,
          content,
          writePpssppUsername(content, account.username)
        );
      } catch (error) {
        await fs.promises.rm(tokenPath, { force: true });
        throw error;
      }

      return configPath;
    },
  },
  dolphin: {
    apply: async (executablePath, account) => {
      const configPath = resolveDolphinConfig(executablePath);
      if (!configPath) return null;

      const content = await readTextOrEmptyIfMissing(configPath);
      if (content === null) return null;
      if (
        !shouldWriteEmulatorAccount(
          readDolphinAccount(content),
          account.username
        )
      ) {
        return null;
      }

      await writeIfChanged(
        configPath,
        content,
        writeDolphinAccount(content, account.username, account.token),
        CREDENTIAL_FILE_MODE
      );
      return configPath;
    },
  },
};

const readConfigText = (configPath: string | null) =>
  configPath ? readText(configPath) : Promise.resolve(null);

const SIGNED_IN_USERNAME_READERS: Record<
  CredentialEmulator,
  (executablePath: string | null) => Promise<string | null>
> = {
  retroarch: async (executablePath) => {
    const content = await readConfigText(
      findExistingConfig(retroArchCredentialConfigCandidates(executablePath))
    );
    return content ? readRetroArchAccount(content).username : null;
  },
  pcsx2: async (executablePath) => {
    const content = await readConfigText(
      findExistingConfig(pcsx2ConfigCandidates(executablePath))
    );
    return content ? readPcsx2Account(content, null).username : null;
  },
  ppsspp: async (executablePath) => {
    const content = await readConfigText(
      findExistingConfig(
        absolutePaths(ppssppConfigCandidates(executablePath ?? ""))
      )
    );
    return content ? readPpssppUsername(content) : null;
  },
  dolphin: async (executablePath) => {
    const content = await readConfigText(resolveDolphinConfig(executablePath));
    return content ? readDolphinAccount(content).username : null;
  },
};

const readDuckStationUsername = async (executablePath: string | null) => {
  const portableConfig = executablePath
    ? path.join(path.dirname(executablePath), "settings.ini")
    : null;
  const configPath =
    portableConfig && fs.existsSync(portableConfig)
      ? portableConfig
      : findExistingConfig(duckstationConfigCandidates());
  const content = await readConfigText(configPath);
  return content ? getIniValue(content, "Cheevos", "Username") : null;
};

export const readEmulatorSignedInUsername = async (
  system: EmulatorSessionSystem,
  executablePath: string | null
) => {
  const resolvedPath = executablePath
    ? (resolveEmulatorExecutableTarget(path.normalize(executablePath)) ??
      executablePath)
    : null;

  if (system === "ps1") {
    return readDuckStationUsername(resolvedPath).catch(() => null);
  }

  const emulator = getCredentialEmulatorForSystem(system);
  if (!emulator) return null;

  return SIGNED_IN_USERNAME_READERS[emulator](resolvedPath).catch(() => null);
};

const getCredentialTargets = async (): Promise<CredentialTarget[]> => {
  const [emulatorConfigs, retroArchConfig] = await Promise.all([
    getAllEmulatorConfigs(),
    getRetroArchConfig(),
  ]);
  const targets = new Map<CredentialEmulator, string | null>(
    CREDENTIAL_EMULATORS.map((emulator) => [emulator, null])
  );

  for (const config of Object.values(emulatorConfigs)) {
    const emulator = BINARY_TO_EMULATOR[config.binary];
    if (emulator && config.executablePath && !targets.get(emulator)) {
      targets.set(emulator, config.executablePath);
    }
  }

  if (retroArchConfig.executablePath) {
    targets.set("retroarch", retroArchConfig.executablePath);
  }

  return Array.from(targets, ([emulator, executablePath]) => ({
    emulator,
    executablePath: executablePath
      ? (resolveEmulatorExecutableTarget(path.normalize(executablePath)) ??
        executablePath)
      : null,
  }));
};

const normalizeProcessPath = (value: string) => {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const isEmulatorRunning = (
  processes: Awaited<ReturnType<typeof NativeAddon.listProcesses>>,
  target: CredentialTarget
) => {
  const executablePath = target.executablePath
    ? normalizeProcessPath(target.executablePath)
    : null;
  const processNames = new Set(
    [
      ...EMULATOR_PROCESS_NAMES[target.emulator],
      ...(target.executablePath ? [path.basename(target.executablePath)] : []),
    ].map((name) => name.toLowerCase())
  );

  return processes.some(
    (runningProcess) =>
      (executablePath &&
        runningProcess.exe &&
        normalizeProcessPath(runningProcess.exe) === executablePath) ||
      processNames.has(runningProcess.name.toLowerCase())
  );
};

let queue: Promise<void> = Promise.resolve();

const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task).catch((error) => {
    logger.error("Failed to update emulator RetroAchievements accounts", error);
  });
  return queue;
};

const signInEmulator = async (
  target: CredentialTarget,
  account: RetroAchievementsEmulatorAccount,
  processes: Awaited<ReturnType<typeof NativeAddon.listProcesses>>
): Promise<void> => {
  if (isEmulatorRunning(processes, target)) {
    logger.info("Skipped RetroAchievements sign-in for a running emulator", {
      emulator: target.emulator,
    });
    return;
  }

  try {
    const configPath = await HANDLERS[target.emulator].apply(
      target.executablePath,
      account
    );
    if (!configPath) return;

    logger.info("Signed emulator into RetroAchievements", {
      emulator: target.emulator,
      configPath,
    });
  } catch (error) {
    logger.error("Failed to sign emulator into RetroAchievements", {
      emulator: target.emulator,
      error,
    });
  }
};

export const syncRetroAchievementsEmulatorCredentials = (
  only?: CredentialEmulator | null
) =>
  enqueue(async () => {
    if (only === null) return;

    const account = await loadRetroAchievementsEmulatorAccount();
    if (!account) return;

    const targets = (await getCredentialTargets()).filter(
      (target) => !only || target.emulator === only
    );
    if (targets.length === 0) return;

    const processes = await NativeAddon.listProcesses().catch(() => []);
    await Promise.all(
      targets.map((target) => signInEmulator(target, account, processes))
    );
  });
