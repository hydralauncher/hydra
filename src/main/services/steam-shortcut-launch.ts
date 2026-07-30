import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";

import type { Game } from "@types";

import { logger } from "./logger";
import {
  composeSteamShortcut,
  generateSteamShortcutAppId,
  getSteamShortcuts,
  getSteamUsersIds,
  writeSteamShortcuts,
} from "./steam";
import { detectSteamClientUsage } from "./steam-client-compat";
import {
  resolveSteamInstallation,
  type SteamInstallation,
} from "./steam-installation";

const CONFIG_FILE = path.join("config", "config.vdf");

const COMPAT_TOOL_MAPPING_KEY = "CompatToolMapping";

const DEFAULT_COMPAT_TOOL_NAME = "proton_experimental";

const COMPAT_TOOL_PRIORITY = "250";

const SHORTCUT_GAME_ID_FLAG = 0x02000000n;

const STEAM_SHUTDOWN_TIMEOUT_MS = 30_000;

const STEAM_STARTUP_TIMEOUT_MS = 60_000;

const STEAM_POLL_INTERVAL_MS = 1000;

const STEAM_SETTLE_MS = 5000;

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const resolveShortcutRunGameId = (shortcutAppId: number) =>
  ((BigInt(shortcutAppId) << 32n) | SHORTCUT_GAME_ID_FLAG).toString();

export const resolveShortcutLaunchOptions = (executablePath: string) => {
  const { dllOverrides } = detectSteamClientUsage(executablePath);

  return dllOverrides ? `WINEDLLOVERRIDES="${dllOverrides}" %command%` : "";
};

const readConfigFile = async (steamInstallPath: string) => {
  const configFilePath = path.join(steamInstallPath, CONFIG_FILE);

  try {
    return {
      configFilePath,
      contents: await fs.promises.readFile(configFilePath, "utf-8"),
    };
  } catch {
    return { configFilePath, contents: null };
  }
};

const findBlockRange = (contents: string, key: string) => {
  const header = new RegExp(
    String.raw`^([^\S\r\n]*)"${key}"[^\S\r\n]*\r?\n[^\S\r\n]*\{`,
    "m"
  ).exec(contents);

  if (!header) return null;

  const openIndex = contents.indexOf("{", header.index);

  let depth = 0;
  let insideQuotes = false;

  for (let index = openIndex; index < contents.length; index += 1) {
    const character = contents[index];

    if (character === '"' && contents[index - 1] !== "\\") {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (insideQuotes) continue;

    if (character === "{") depth += 1;

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return {
          indentation: header[1],
          startIndex: header.index,
          openIndex,
          closeIndex: index,
        };
      }
    }
  }

  return null;
};

const readMappedCompatTool = (mappingBlock: string, appId: string) => {
  const entry = findBlockRange(mappingBlock, appId);

  if (!entry) return null;

  return (
    /"name"\s*"([^"]*)"/.exec(
      mappingBlock.slice(entry.openIndex, entry.closeIndex)
    )?.[1] ?? null
  );
};

export const resolveDefaultCompatToolName = (mappingBlock: string) =>
  readMappedCompatTool(mappingBlock, "0") ?? DEFAULT_COMPAT_TOOL_NAME;

const buildCompatToolEntry = (
  appId: string,
  toolName: string,
  indentation: string
) =>
  [
    `${indentation}"${appId}"`,
    `${indentation}{`,
    `${indentation}\t"name"\t\t"${toolName}"`,
    `${indentation}\t"config"\t\t""`,
    `${indentation}\t"priority"\t\t"${COMPAT_TOOL_PRIORITY}"`,
    `${indentation}}`,
  ].join("\n");

export const upsertCompatToolMapping = (
  contents: string,
  appId: string,
  toolName: string
) => {
  const mapping = findBlockRange(contents, COMPAT_TOOL_MAPPING_KEY);

  if (!mapping) return null;

  const mappingBlock = contents.slice(
    mapping.openIndex,
    mapping.closeIndex + 1
  );
  const entry = buildCompatToolEntry(
    appId,
    toolName,
    `${mapping.indentation}\t`
  );

  const existing = findBlockRange(mappingBlock, appId);

  if (existing) {
    if (readMappedCompatTool(mappingBlock, appId) === toolName) return contents;

    return (
      contents.slice(0, mapping.openIndex + existing.startIndex) +
      entry +
      contents.slice(mapping.openIndex + existing.closeIndex + 1)
    );
  }

  return (
    contents.slice(0, mapping.openIndex + 1) +
    `\n${entry}` +
    contents.slice(mapping.openIndex + 1)
  );
};

const ensureCompatToolMapping = async (
  steamInstallPath: string,
  shortcutAppId: number
) => {
  const { configFilePath, contents } = await readConfigFile(steamInstallPath);

  if (!contents) {
    logger.warn(
      "Could not read the Steam config to set the compatibility tool",
      {
        configFilePath,
      }
    );
    return false;
  }

  const mapping = findBlockRange(contents, COMPAT_TOOL_MAPPING_KEY);

  const appId = String(shortcutAppId);
  const toolName = mapping
    ? resolveDefaultCompatToolName(
        contents.slice(mapping.openIndex, mapping.closeIndex + 1)
      )
    : DEFAULT_COMPAT_TOOL_NAME;

  const updated = upsertCompatToolMapping(contents, appId, toolName);

  if (!updated) {
    logger.warn(
      "Could not find the compatibility tool mapping in the Steam config",
      {
        configFilePath,
      }
    );
    return false;
  }

  if (updated === contents) return false;

  await fs.promises.copyFile(configFilePath, `${configFilePath}.hydra-backup`);
  await fs.promises.writeFile(configFilePath, updated);

  logger.info("Mapped a compatibility tool to the Steam shortcut", {
    appId,
    toolName,
  });

  return true;
};

const ensureShortcut = async (
  installation: SteamInstallation,
  game: Game,
  executablePath: string
) => {
  const shortcutAppId = generateSteamShortcutAppId(executablePath, game.title);
  const launchOptions = resolveShortcutLaunchOptions(executablePath);

  let changed = false;

  for (const steamUserId of await getSteamUsersIds(installation.rootPath)) {
    const shortcuts = await getSteamShortcuts(
      steamUserId,
      installation.rootPath
    );
    const existing = shortcuts.find(
      (shortcut) => shortcut.appid === shortcutAppId
    );

    if (existing) {
      if (existing.LaunchOptions === launchOptions) continue;

      existing.LaunchOptions = launchOptions;
    } else {
      shortcuts.push(
        composeSteamShortcut(game.title, executablePath, null, undefined, {
          launchOptions,
        })
      );
    }

    await writeSteamShortcuts(steamUserId, shortcuts, installation.rootPath);
    changed = true;
  }

  return { shortcutAppId, changed };
};

const shutdownSteamClient = async (installation: SteamInstallation) => {
  if (!installation.spawnSteam(["-shutdown"])) return false;

  const deadline = performance.now() + STEAM_SHUTDOWN_TIMEOUT_MS;

  while (performance.now() < deadline) {
    await wait(STEAM_POLL_INTERVAL_MS);

    if (!installation.isRunning()) return true;
  }

  return false;
};

const startSteamClient = async (installation: SteamInstallation) => {
  if (installation.isRunning()) return true;

  if (!installation.spawnSteam(["-silent"])) return false;

  const deadline = performance.now() + STEAM_STARTUP_TIMEOUT_MS;

  while (performance.now() < deadline) {
    await wait(STEAM_POLL_INTERVAL_MS);

    if (installation.isRunning()) {
      await wait(STEAM_SETTLE_MS);
      return true;
    }
  }

  return false;
};

export const launchThroughSteamShortcut = async (
  game: Game,
  executablePath: string,
  onStatus: (status: "preparing" | "restarting" | "starting") => void
): Promise<string | null> => {
  const installation = await resolveSteamInstallation();

  if (!installation) return null;

  if (!(await getSteamUsersIds(installation.rootPath)).length) {
    logger.warn(
      "No Steam user was found, cannot launch the game through a shortcut",
      { rootPath: installation.rootPath }
    );
    return null;
  }

  const wasRunning = installation.isRunning();

  onStatus("preparing");

  const { shortcutAppId, changed } = await ensureShortcut(
    installation,
    game,
    executablePath
  );
  const mappingChanged = await ensureCompatToolMapping(
    installation.rootPath,
    shortcutAppId
  );

  const needsRestart = changed || mappingChanged;

  if (needsRestart && wasRunning) {
    onStatus("restarting");

    if (!(await shutdownSteamClient(installation))) {
      logger.warn("Could not close the Steam client to apply the shortcut");
      return null;
    }

    await ensureShortcut(installation, game, executablePath);
    await ensureCompatToolMapping(installation.rootPath, shortcutAppId);
  }

  onStatus("starting");

  if (!(await startSteamClient(installation))) {
    logger.warn("Could not start the Steam client for the shortcut");
    return null;
  }

  const runGameId = resolveShortcutRunGameId(shortcutAppId);

  logger.info("Launching the game through a Steam shortcut", {
    executablePath,
    shortcutAppId,
    runGameId,
  });

  await shell.openExternal(`steam://rungameid/${runGameId}`);

  return runGameId;
};
