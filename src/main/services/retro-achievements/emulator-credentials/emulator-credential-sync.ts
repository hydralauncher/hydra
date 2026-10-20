import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EmulatorBinary, EmulatorSystem } from "@types";

import { db, levelKeys } from "@main/level";
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
  clearDolphinAccount,
  clearDuckStationAccount,
  clearPcsx2Account,
  clearRetroArchAccount,
  isEmulatorAccountOwnedBy,
  readDolphinAccount,
  readDuckStationAccount,
  readPcsx2Account,
  readPpssppUsername,
  readRetroArchAccount,
  shouldWriteEmulatorAccount,
  writeDolphinAccount,
  writeDuckStationAccount,
  writePcsx2Account,
  writePcsx2Token,
  writePpssppUsername,
  writeRetroArchAccount,
  PPSSPP_SECTION,
  removeIniValue,
} from "./emulator-credential-config";
import { encryptDuckStationLoginToken } from "./duckstation-login-token";
import { readDuckStationMachineKey } from "./duckstation-machine-key";

export type CredentialEmulator =
  | "retroarch"
  | "duckstation"
  | "pcsx2"
  | "ppsspp"
  | "dolphin";

interface CredentialWrite {
  emulator: CredentialEmulator;
  configPath: string;
}

interface CredentialTarget {
  emulator: CredentialEmulator;
  executablePath: string | null;
}

interface CredentialHandler {
  apply: (
    executablePath: string | null,
    account: RetroAchievementsEmulatorAccount
  ) => Promise<string | null>;
  clear: (configPath: string, username: string) => Promise<void>;
}

const BINARY_TO_EMULATOR: Partial<Record<EmulatorBinary, CredentialEmulator>> =
  {
    duckstation: "duckstation",
    pcsx2: "pcsx2",
    ppsspp: "ppsspp",
    dolphin: "dolphin",
  };

const SYSTEM_TO_EMULATOR: Partial<
  Record<EmulatorSessionSystem, CredentialEmulator | null>
> = {
  ps1: "duckstation",
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
  "duckstation",
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
  duckstation: knownExecutableNames("ps1"),
  pcsx2: knownExecutableNames("ps2"),
  ppsspp: knownExecutableNames("psp"),
  dolphin: knownExecutableNames("dolphin"),
};

const absolutePaths = (paths: string[]) =>
  paths.filter((candidate) => path.isAbsolute(candidate));

const readText = (filePath: string) =>
  fs.promises.readFile(filePath, "utf8").catch(() => null);

const writeIfChanged = async (
  filePath: string,
  original: string,
  updated: string
) => {
  if (updated === original) return;
  await fs.promises.writeFile(filePath, updated, "utf8");
};

const unixTimestamp = () => Math.floor(Date.now() / 1000);

const resolveDuckStationConfig = (executablePath: string | null) => {
  if (executablePath) {
    const executableDirectory = path.dirname(executablePath);
    const portableConfig = path.join(executableDirectory, "settings.ini");
    const isPortable =
      fs.existsSync(path.join(executableDirectory, "portable.txt")) ||
      fs.existsSync(portableConfig);

    if (isPortable) {
      return fs.existsSync(portableConfig)
        ? { configPath: portableConfig, isPortable }
        : null;
    }
  }

  const configPath = findExistingConfig(duckstationConfigCandidates());
  return configPath ? { configPath, isPortable: false } : null;
};

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
    clear: async (configPath, username) => {
      const content = await readText(configPath);
      if (content === null) return;
      if (!isEmulatorAccountOwnedBy(readRetroArchAccount(content), username)) {
        return;
      }
      await writeIfChanged(configPath, content, clearRetroArchAccount(content));
    },
  },
  duckstation: {
    apply: async (executablePath, account) => {
      const config = resolveDuckStationConfig(executablePath);
      if (!config) return null;

      const content = await readText(config.configPath);
      if (content === null) return null;
      if (
        !shouldWriteEmulatorAccount(
          readDuckStationAccount(content),
          account.username
        )
      ) {
        return null;
      }

      const machineKey = config.isPortable
        ? null
        : await readDuckStationMachineKey();
      if (!config.isPortable && !machineKey) return null;

      await writeIfChanged(
        config.configPath,
        content,
        writeDuckStationAccount(
          content,
          account.username,
          encryptDuckStationLoginToken(
            account.token,
            account.username,
            machineKey
          ),
          unixTimestamp()
        )
      );
      return config.configPath;
    },
    clear: async (configPath, username) => {
      const content = await readText(configPath);
      if (content === null) return;
      if (
        !isEmulatorAccountOwnedBy(readDuckStationAccount(content), username)
      ) {
        return;
      }
      await writeIfChanged(
        configPath,
        content,
        clearDuckStationAccount(content)
      );
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
        await writeIfChanged(
          secretsPath,
          secretsContent,
          writePcsx2Token(secretsContent, account.token)
        );
        await writeIfChanged(
          configPath,
          content,
          writePcsx2Account(content, account.username, unixTimestamp())
        );
      }

      return configPath;
    },
    clear: async (configPath, username) => {
      const content = await readText(configPath);
      if (content === null) return;

      const secretsPath = pcsx2SecretsPath(configPath);
      const secretsContent = await readText(secretsPath);
      if (
        !isEmulatorAccountOwnedBy(
          readPcsx2Account(content, secretsContent),
          username
        )
      ) {
        return;
      }

      await writeIfChanged(configPath, content, clearPcsx2Account(content));
      if (secretsContent !== null) {
        await writeIfChanged(
          secretsPath,
          secretsContent,
          clearPcsx2Account(secretsContent)
        );
      }
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
      const existingToken = await readText(tokenPath);
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

      await fs.promises.writeFile(tokenPath, account.token, "utf8");
      await writeIfChanged(
        configPath,
        content,
        writePpssppUsername(content, account.username)
      );
      return configPath;
    },
    clear: async (configPath, username) => {
      const content = await readText(configPath);
      if (content === null) return;
      if (
        !isEmulatorAccountOwnedBy(
          { username: readPpssppUsername(content), hasToken: true },
          username
        )
      ) {
        return;
      }

      await fs.promises.rm(ppssppTokenPath(configPath), { force: true });
      await writeIfChanged(
        configPath,
        content,
        removeIniValue(content, PPSSPP_SECTION, "AchievementsUserName")
      );
    },
  },
  dolphin: {
    apply: async (executablePath, account) => {
      const configPath = resolveDolphinConfig(executablePath);
      if (!configPath) return null;

      const content = (await readText(configPath)) ?? "";
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
        writeDolphinAccount(content, account.username, account.token)
      );
      return configPath;
    },
    clear: async (configPath, username) => {
      const content = await readText(configPath);
      if (content === null) return;
      if (!isEmulatorAccountOwnedBy(readDolphinAccount(content), username)) {
        return;
      }
      await writeIfChanged(configPath, content, clearDolphinAccount(content));
    },
  },
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

const loadCredentialWrites = async () =>
  (await db
    .get<
      string,
      CredentialWrite[] | null
    >(levelKeys.retroAchievementsEmulatorCredentialWrites, { valueEncoding: "json" })
    .catch(() => null)) ?? [];

const saveCredentialWrites = async (writes: CredentialWrite[]) => {
  if (writes.length === 0) {
    await db
      .del(levelKeys.retroAchievementsEmulatorCredentialWrites)
      .catch(() => undefined);
    return;
  }

  await db.put<string, CredentialWrite[]>(
    levelKeys.retroAchievementsEmulatorCredentialWrites,
    writes,
    { valueEncoding: "json" }
  );
};

let queue: Promise<void> = Promise.resolve();

const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task).catch((error) => {
    logger.error("Failed to update emulator RetroAchievements accounts", error);
  });
  return queue;
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
    const writes = await loadCredentialWrites();
    let changed = false;

    for (const target of targets) {
      if (isEmulatorRunning(processes, target)) {
        logger.info(
          "Skipped RetroAchievements sign-in for a running emulator",
          {
            emulator: target.emulator,
          }
        );
        continue;
      }

      try {
        const configPath = await HANDLERS[target.emulator].apply(
          target.executablePath,
          account
        );
        if (!configPath) continue;

        logger.info("Signed emulator into RetroAchievements", {
          emulator: target.emulator,
          configPath,
        });

        if (
          !writes.some(
            (write) =>
              write.emulator === target.emulator &&
              write.configPath === configPath
          )
        ) {
          writes.push({ emulator: target.emulator, configPath });
          changed = true;
        }
      } catch (error) {
        logger.error("Failed to sign emulator into RetroAchievements", {
          emulator: target.emulator,
          error,
        });
      }
    }

    if (changed) await saveCredentialWrites(writes);
  });

export const clearRetroAchievementsEmulatorCredentials = (username: string) =>
  enqueue(async () => {
    const writes = await loadCredentialWrites();

    for (const write of writes) {
      try {
        await HANDLERS[write.emulator].clear(write.configPath, username);
      } catch (error) {
        logger.error("Failed to sign emulator out of RetroAchievements", {
          emulator: write.emulator,
          error,
        });
      }
    }

    await saveCredentialWrites([]);
  });
