import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { readStableFile } from "./epic-achievement-parsers.js";

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_SAVEPATH_LENGTH = 4096;

const CONFIG_LOCATIONS = [
  ["NemirtingasEpicEmu.json"],
  ["nepice_settings", "NemirtingasEpicEmu.json"],
];

const staysWithinDirectory = (directory: string, target: string) => {
  const relative = path.relative(directory, target);

  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const readSavepath = (
  configPath: string,
  onWarning: (message: string) => void
): string | undefined | null => {
  const bytes = readStableFile(configPath, MAX_CONFIG_BYTES);
  let config: unknown;

  try {
    if (!bytes) throw new Error("Incomplete configuration");
    config = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    onWarning("Unreadable Nemirtingas configuration; skipping emulator state");
    return null;
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    onWarning("Invalid Nemirtingas configuration; skipping emulator state");
    return null;
  }

  const savepath = (config as Record<string, unknown>).savepath;
  if (savepath === undefined || savepath === "appdata") return undefined;

  if (typeof savepath !== "string" || savepath.length > MAX_SAVEPATH_LENGTH) {
    onWarning("Invalid Nemirtingas savepath; skipping emulator state");
    return null;
  }

  return savepath;
};

const resolveSavepath = async (
  gameDirectory: string,
  savepath: string,
  onWarning: (message: string) => void
): Promise<string | null> => {
  const normalized = savepath.replaceAll("\\", "/");

  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(savepath) ||
    /^[a-z]:/i.test(normalized)
  ) {
    onWarning(
      "Absolute Nemirtingas savepath is unsupported; skipping emulator state"
    );
    return null;
  }

  const saveRoot = path.resolve(gameDirectory, normalized);
  if (!staysWithinDirectory(gameDirectory, saveRoot)) {
    onWarning(
      "Nemirtingas savepath leaves the game directory; skipping emulator state"
    );
    return null;
  }

  const [canonicalGameDirectory, canonicalSaveRoot] = await Promise.all([
    realpath(gameDirectory).catch(() => null),
    realpath(saveRoot).catch(() => null),
  ]);

  if (
    canonicalGameDirectory &&
    canonicalSaveRoot &&
    !staysWithinDirectory(canonicalGameDirectory, canonicalSaveRoot)
  ) {
    onWarning(
      "Nemirtingas savepath resolves outside the game directory; skipping emulator state"
    );
    return null;
  }

  return saveRoot;
};

/**
 * Nemirtingas saves under AppData unless the configuration next to the game
 * sets a `savepath`, which is relative to the game directory.
 *
 * Returns undefined to keep AppData, a path to use instead, or null when the
 * configuration cannot be trusted and the emulator state must be skipped.
 */
export const getNemirtingasSaveRoot = async (
  executablePath: string | null,
  onWarning: (message: string) => void = () => {}
): Promise<string | undefined | null> => {
  if (!executablePath || !path.isAbsolute(executablePath)) return undefined;

  const gameDirectory = path.dirname(executablePath);

  for (const location of CONFIG_LOCATIONS) {
    const configPath = path.join(gameDirectory, ...location);
    const info = await lstat(configPath).catch(() => null);
    if (!info) continue;

    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_CONFIG_BYTES
    ) {
      onWarning("Invalid Nemirtingas configuration; skipping emulator state");
      return null;
    }

    const savepath = readSavepath(configPath, onWarning);
    if (savepath === null || savepath === undefined) return savepath;

    return resolveSavepath(gameDirectory, savepath, onWarning);
  }

  return undefined;
};
