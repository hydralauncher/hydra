import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  RecompilationActionResult,
  RecompilationRef,
  RecompilationRomMeta,
  RecompilationRomSource,
  RecompilationRomState,
} from "@types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { logger, SevenZip } from "@main/services";
import {
  getRecompilationInstallDirectory,
  parseRecompilationRef,
} from "./recompilation-paths";
import recompilationMeta from "./recompilation-meta.json";

const ROM_META = recompilationMeta as Record<
  string,
  | {
      rom: RecompilationRomMeta | null;
      /** Ports Hydra cannot hand a ROM to: how to spot it in the library. */
      romExtensions?: string[];
    }
  | undefined
>;

const getRomMetaEntry = (slug: string) =>
  Object.hasOwn(ROM_META, slug) ? ROM_META[slug] : undefined;

/**
 * How a port receives the ROM, or null when Hydra cannot hand it one (the
 * port asks for it itself). Ports missing from the meta file count as null.
 */
const getRecompilationRomMeta = (slug: string): RecompilationRomMeta | null =>
  getRomMetaEntry(slug)?.rom ?? null;

/** Extensions that identify the port's ROM in the library. */
const getLibraryRomExtensions = (slug: string) =>
  getRecompilationRomMeta(slug)?.extensions ??
  getRomMetaEntry(slug)?.romExtensions ??
  [];

type MetaPlatform = "win32" | "linux" | "darwin";

/** The ROM the user chose for a port. Lives in the port folder. */
const ROM_CHOICE_FILE = ".hydra-recompilation-rom.json";
/** Where an archived ROM is extracted, inside the port folder. */
const EXTRACTED_ROM_FOLDER = ".hydra-rom";
const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"]);
const ROM_SCAN_DEPTH = 2;

interface RomChoice {
  source: RecompilationRomSource;
  /** Only for "file": the file the user picked. */
  path?: string;
  /** The ROM file the port folder was prepared from (copy or installer). */
  preparedFrom?: string;
  /** Where that ROM was copied to, for ports that read a copy. */
  preparedTarget?: string;
  /** Set after the first launch with this ROM, for `once` ports. */
  launched?: boolean;
}

const hasExtension = (filePath: string, extensions: string[]) =>
  extensions.includes(path.extname(filePath).toLowerCase());

const fileExists = async (filePath: string | null | undefined) => {
  if (!filePath) return false;
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
};

const readRomChoice = async (
  installDirectory: string
): Promise<RomChoice | null> => {
  try {
    const raw = await fs.promises.readFile(
      path.join(installDirectory, ROM_CHOICE_FILE),
      "utf-8"
    );
    const parsed = JSON.parse(raw) as RomChoice;
    return parsed.source === "library" || parsed.source === "file"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const writeRomChoice = async (installDirectory: string, choice: RomChoice) => {
  await fs.promises.mkdir(installDirectory, { recursive: true });
  await fs.promises.writeFile(
    path.join(installDirectory, ROM_CHOICE_FILE),
    JSON.stringify(choice, null, 2)
  );
};

/** The biggest file under a folder with one of the port's extensions. */
const findRomInFolder = async (
  directory: string,
  extensions: string[],
  depth = 0
): Promise<{ path: string; size: number } | null> => {
  if (depth > ROM_SCAN_DEPTH) return null;

  let best: { path: string; size: number } | null = null;
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const candidate = entry.isDirectory()
      ? await findRomInFolder(entryPath, extensions, depth + 1)
      : entry.isFile() && hasExtension(entry.name, extensions)
        ? { path: entryPath, size: (await fs.promises.stat(entryPath)).size }
        : null;
    if (candidate && (!best || candidate.size > best.size)) best = candidate;
  }

  return best;
};

/**
 * The base game's ROM in the library: the disc chosen for the Classics game,
 * else the file of a finished download of it.
 */
const getLibraryRomPath = async (objectId: string, extensions: string[]) => {
  const key = levelKeys.game("launchbox", objectId);

  const game = await gamesSublevel.get(key).catch(() => null);
  if (game && !game.isDeleted) {
    const disc = game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    if (disc && hasExtension(disc, extensions) && (await fileExists(disc))) {
      return disc;
    }
  }

  const download = await downloadsSublevel.get(key).catch(() => null);
  if (download?.status !== "complete" || !download.folderName) return null;

  const downloaded = path.join(download.downloadPath, download.folderName);
  if (await fileExists(downloaded)) {
    return hasExtension(downloaded, extensions) ||
      ARCHIVE_EXTENSIONS.has(path.extname(downloaded).toLowerCase())
      ? downloaded
      : null;
  }
  return (await findRomInFolder(downloaded, extensions))?.path ?? null;
};

const resolvePlaceholders = (
  template: string,
  installDirectory: string,
  romName: string
) => {
  const home = os.homedir();
  const values: Record<string, string> = {
    "<base>": installDirectory,
    "<home>": home,
    "<winLocalAppData>":
      process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
    "<winAppData>":
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
    "<xdgData>":
      process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
    "{romName}": romName,
  };

  return path.normalize(
    template.replace(
      /<base>|<home>|<winLocalAppData>|<winAppData>|<xdgData>|\{romName\}/g,
      (token) => values[token]
    )
  );
};

const getCopyTarget = (
  meta: RecompilationRomMeta,
  installDirectory: string,
  romName: string
) => {
  const template = meta.copyTo?.[process.platform as MetaPlatform];
  return template
    ? resolvePlaceholders(template, installDirectory, romName)
    : null;
};

/**
 * Whether the port already has the game data: one of the files it writes
 * after importing the ROM, or the copy Hydra made for it.
 */
const isPortReady = async (
  meta: RecompilationRomMeta,
  installDirectory: string,
  choice: RomChoice | null
) => {
  const imported = meta.imported?.[process.platform as MetaPlatform] ?? [];
  for (const template of imported) {
    if (await fileExists(resolvePlaceholders(template, installDirectory, ""))) {
      return true;
    }
  }
  return (
    meta.copyTo !== undefined && (await fileExists(choice?.preparedTarget))
  );
};

export const getRecompilationRomState = async (
  rawRef: unknown
): Promise<RecompilationRomState | null> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return null;

  const meta = getRecompilationRomMeta(ref.slug);
  const installDirectory = await getRecompilationInstallDirectory(ref.slug);
  const [choice, libraryRomPath] = await Promise.all([
    readRomChoice(installDirectory),
    getLibraryRomPath(ref.objectId, getLibraryRomExtensions(ref.slug)),
  ]);

  let romPath: string | null = null;
  if (choice?.source === "file" && (await fileExists(choice.path))) {
    romPath = choice.path!;
  } else if (choice?.source === "library") {
    romPath = libraryRomPath;
  }

  return {
    handlesRom: meta !== null,
    source: choice?.source ?? null,
    romPath,
    libraryRomPath,
    isReady: meta ? await isPortReady(meta, installDirectory, choice) : false,
    extensions: (meta?.extensions ?? []).map((extension) => extension.slice(1)),
  };
};

export const setRecompilationRom = async (
  rawRef: unknown,
  rawChoice: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  const meta = ref ? getRecompilationRomMeta(ref.slug) : null;
  if (!ref || !meta) {
    return { ok: false, reason: "invalid_port" };
  }

  const { source, path: romPath } = (rawChoice ?? {}) as Record<
    string,
    unknown
  >;
  if (source === "file") {
    if (typeof romPath !== "string" || !(await fileExists(romPath))) {
      return { ok: false, reason: "rom_not_found" };
    }
    if (!hasExtension(romPath, meta.extensions)) {
      return { ok: false, reason: "rom_wrong_format" };
    }
  } else if (source !== "library") {
    return { ok: false, reason: "invalid_rom" };
  }

  // What the port was prepared from is kept: choosing the same ROM again
  // does not redo the copy or the import.
  const installDirectory = await getRecompilationInstallDirectory(ref.slug);
  const previous = await readRomChoice(installDirectory);
  await writeRomChoice(installDirectory, {
    preparedFrom: previous?.preparedFrom,
    preparedTarget: previous?.preparedTarget,
    launched: previous?.launched,
    source,
    path: source === "file" ? (romPath as string) : undefined,
  });
  return { ok: true };
};

/**
 * A downloaded ROM that is still an archive is extracted once into the port
 * folder. Files picked by the user are never archives.
 */
const unpackRom = async (
  romPath: string,
  installDirectory: string,
  extensions: string[]
) => {
  if (!ARCHIVE_EXTENSIONS.has(path.extname(romPath).toLowerCase())) {
    return romPath;
  }

  const outputPath = path.join(installDirectory, EXTRACTED_ROM_FOLDER);
  await fs.promises.rm(outputPath, { recursive: true, force: true });
  await SevenZip.extractFile({ filePath: romPath, outputPath });

  const extracted = await findRomInFolder(outputPath, extensions);
  if (!extracted) throw new Error("rom_not_found");
  return extracted.path;
};

/** N64 ROMs come in three byte orders. The .z64 one is big-endian. */
const toZ64 = (data: Buffer) => {
  const first = data.readUInt32BE(0);
  if (first === 0x80371240) return data;

  const out = Buffer.from(data);
  if (first === 0x37804012) {
    out.swap16();
  } else if (first === 0x40123780) {
    out.swap32();
  } else {
    throw new Error("not_n64_rom");
  }
  return out;
};

/**
 * Puts the ROM where the port reads it. Tries a hard link first, so the
 * file is not stored twice when both are on the same drive.
 */
const copyRom = async (
  source: string,
  target: string,
  format: RecompilationRomMeta["format"]
) => {
  if (path.resolve(source) === path.resolve(target)) return;

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.rm(target, { force: true });

  if (format === "z64") {
    const data = await fs.promises.readFile(source);
    const converted = toZ64(data);
    if (converted !== data) {
      await fs.promises.writeFile(target, converted);
      return;
    }
  }

  try {
    await fs.promises.link(source, target);
  } catch {
    await fs.promises.copyFile(source, target);
  }
};

const runRomInstaller = (
  command: string[],
  installDirectory: string,
  romPath: string
) =>
  new Promise<void>((resolve, reject) => {
    const [name, ...args] = command;
    const candidates =
      process.platform === "win32" ? [`${name}.exe`, name] : [name];
    const executable = candidates
      .map((candidate) => path.join(installDirectory, candidate))
      .find((candidate) => fs.existsSync(candidate));
    if (!executable) {
      reject(new Error(`ROM installer ${name} not found`));
      return;
    }

    const child = spawn(
      executable,
      args.map((arg) => arg.replaceAll("{rom}", romPath)),
      { cwd: installDirectory, stdio: "ignore", shell: false }
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ROM installer exited with ${code}`))
    );
  });

export type RecompilationLaunch =
  | { ok: true; args: string[]; env: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Gets the port ready to start with the chosen ROM and returns the extra
 * arguments and environment for this launch.
 */
export const prepareRecompilationRom = async (
  ref: RecompilationRef,
  installDirectory: string
): Promise<RecompilationLaunch> => {
  const meta = getRecompilationRomMeta(ref.slug);
  if (!meta) return { ok: true, args: [], env: {} };

  const state = await getRecompilationRomState(ref);
  const choice = await readRomChoice(installDirectory);

  // A port that has the game data starts without the ROM, so the ROM file
  // can be moved or deleted. A newly chosen ROM is still handed over.
  const isNewRom =
    Boolean(state?.romPath) && choice?.preparedFrom !== state?.romPath;
  if (state?.isReady && !isNewRom) return { ok: true, args: [], env: {} };

  if (!state?.romPath || !choice) return { ok: false, reason: "no_rom" };

  const isPrepared = choice.preparedFrom === state.romPath;
  let romPath = state.romPath;

  try {
    if (!isPrepared || !(await fileExists(romPath))) {
      romPath = await unpackRom(
        state.romPath,
        installDirectory,
        meta.extensions
      );
    } else if (
      ARCHIVE_EXTENSIONS.has(path.extname(state.romPath).toLowerCase())
    ) {
      romPath =
        (
          await findRomInFolder(
            path.join(installDirectory, EXTRACTED_ROM_FOLDER),
            meta.extensions
          )
        )?.path ??
        (await unpackRom(state.romPath, installDirectory, meta.extensions));
    }

    const target =
      getCopyTarget(meta, installDirectory, path.basename(romPath)) ??
      (meta.format === "z64" && path.extname(romPath).toLowerCase() !== ".z64"
        ? path.join(
            installDirectory,
            EXTRACTED_ROM_FOLDER,
            `${path.parse(romPath).name}.z64`
          )
        : null);
    if (target && (!isPrepared || !(await fileExists(target)))) {
      await copyRom(romPath, target, meta.format);
    }
    if (target) romPath = target;

    // Reaching here with an import check means the import is not there yet
    // (or a new ROM was chosen), so the installer runs again.
    if (meta.path?.installer && (!isPrepared || meta.imported)) {
      await runRomInstaller(meta.path.installer, installDirectory, romPath);
    }

    if (!isPrepared || (target ?? undefined) !== choice.preparedTarget) {
      await writeRomChoice(installDirectory, {
        ...choice,
        preparedFrom: state.romPath,
        preparedTarget: target ?? undefined,
        launched: isPrepared ? choice.launched : false,
      });
    }
  } catch (error) {
    logger.error(`Failed to prepare the ROM for ${ref.slug}`, error);
    return { ok: false, reason: "rom_prepare_failed" };
  }

  // Ports with an import check get the ROM until their import is on disk;
  // the others only on the first launch with it.
  const passRom =
    meta.imported !== undefined ||
    !(meta.once && isPrepared && choice.launched);
  const fill = (value: string) =>
    value
      .replaceAll("{rom}", romPath)
      .replaceAll("{romName}", path.basename(romPath));

  return {
    ok: true,
    args: passRom ? (meta.path?.arg ?? []).map(fill) : [],
    env: passRom
      ? Object.fromEntries(
          Object.entries(meta.path?.env ?? {}).map(([key, value]) => [
            key,
            fill(value),
          ])
        )
      : {},
  };
};

export const markRecompilationRomLaunched = async (
  installDirectory: string
) => {
  const choice = await readRomChoice(installDirectory);
  if (choice && !choice.launched) {
    await writeRomChoice(installDirectory, { ...choice, launched: true });
  }
};
