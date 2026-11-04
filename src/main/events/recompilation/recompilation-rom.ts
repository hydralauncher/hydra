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
import { isCompletedLikeDownload } from "../../../types";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { logger, SevenZip } from "@main/services";
import {
  getRecompilationInstallDirectory,
  parseRecompilationRef,
} from "./recompilation-paths";
import recompilationMeta from "./recompilation-meta.json";
import { toZ64 } from "./n64-rom";

const ROM_META = recompilationMeta as Record<
  string,
  | {
      rom: RecompilationRomMeta | null;
      romExtensions?: string[];
    }
  | undefined
>;

const getRomMetaEntry = (slug: string) =>
  Object.hasOwn(ROM_META, slug) ? ROM_META[slug] : undefined;

const getRecompilationRomMeta = (slug: string): RecompilationRomMeta | null =>
  getRomMetaEntry(slug)?.rom ?? null;

const getLibraryRomExtensions = (slug: string) =>
  getRecompilationRomMeta(slug)?.extensions ??
  getRomMetaEntry(slug)?.romExtensions ??
  [];

type MetaPlatform = "win32" | "linux";

const ROM_CHOICE_FILE = ".hydra-recompilation-rom.json";
const EXTRACTED_ROM_FOLDER = ".hydra-rom";
const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"]);
const ROM_SCAN_DEPTH = 2;

interface RomChoice {
  source: RecompilationRomSource;
  path?: string;
  preparedFrom?: string;
  preparedTarget?: string;
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
    let candidate: { path: string; size: number } | null = null;
    if (entry.isDirectory()) {
      candidate = await findRomInFolder(entryPath, extensions, depth + 1);
    } else if (entry.isFile() && hasExtension(entry.name, extensions)) {
      candidate = {
        path: entryPath,
        size: (await fs.promises.stat(entryPath)).size,
      };
    }
    if (candidate && (!best || candidate.size > best.size)) best = candidate;
  }

  return best;
};

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
  // A download still extracting counts as complete, but its files are partial.
  if (
    !download ||
    !isCompletedLikeDownload(download) ||
    download.extracting ||
    !download.folderName
  ) {
    return null;
  }

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

  const installDirectory = await getRecompilationInstallDirectory(ref.slug);
  const previous = await readRomChoice(installDirectory);
  await writeRomChoice(installDirectory, {
    preparedFrom: previous?.preparedFrom,
    preparedTarget: previous?.preparedTarget,
    launched: false,
    source,
    path: source === "file" ? (romPath as string) : undefined,
  });
  return { ok: true };
};

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

const writeRomFile = async (
  source: string,
  destination: string,
  format: RecompilationRomMeta["format"]
) => {
  if (format === "z64") {
    const data = await fs.promises.readFile(source);
    const converted = toZ64(data);
    if (converted !== data) {
      await fs.promises.writeFile(destination, converted);
      return;
    }
  }

  try {
    await fs.promises.link(source, destination);
  } catch {
    await fs.promises.copyFile(source, destination);
  }
};

const removeStaleRomTarget = async (
  installDirectory: string,
  previous: string | undefined,
  current: string | null,
  romPath: string
) => {
  if (!previous || previous === current) return;
  if (path.resolve(previous) === path.resolve(romPath)) return;

  const relative = path.relative(installDirectory, previous);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  await fs.promises.rm(previous, { force: true });
};

const copyRom = async (
  source: string,
  target: string,
  format: RecompilationRomMeta["format"]
) => {
  if (path.resolve(source) === path.resolve(target)) return;

  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const temporaryTarget = `${target}.hydra-partial`;
  await fs.promises.rm(temporaryTarget, { force: true });

  try {
    await writeRomFile(source, temporaryTarget, format);
    await fs.promises.rm(target, { force: true });
    await fs.promises.rename(temporaryTarget, target);
  } finally {
    await fs.promises.rm(temporaryTarget, { force: true });
  }
};

const fillRomPlaceholders = (value: string, romPath: string) =>
  value
    .replaceAll("{rom}", () => romPath)
    .replaceAll("{romName}", () => path.basename(romPath));

const getRomTarget = (
  meta: RecompilationRomMeta,
  installDirectory: string,
  romPath: string
) => {
  const copyTarget = getCopyTarget(
    meta,
    installDirectory,
    path.basename(romPath)
  );
  if (copyTarget) return copyTarget;
  if (meta.format !== "z64" || path.extname(romPath).toLowerCase() === ".z64") {
    return null;
  }
  return path.join(
    installDirectory,
    EXTRACTED_ROM_FOLDER,
    `${path.parse(romPath).name}.z64`
  );
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
      args.map((arg) => fillRomPlaceholders(arg, romPath)),
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

export const prepareRecompilationRom = async (
  ref: RecompilationRef,
  installDirectory: string
): Promise<RecompilationLaunch> => {
  const meta = getRecompilationRomMeta(ref.slug);
  if (!meta) return { ok: true, args: [], env: {} };

  const state = await getRecompilationRomState(ref);
  const choice = await readRomChoice(installDirectory);

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

    const target = getRomTarget(meta, installDirectory, romPath);
    if (target && (!isPrepared || !(await fileExists(target)))) {
      await copyRom(romPath, target, meta.format);
    }
    // The resolved source, not the archive: it may be the previous target.
    const sourceRomPath = romPath;
    if (target) romPath = target;
    await removeStaleRomTarget(
      installDirectory,
      choice.preparedTarget,
      target,
      sourceRomPath
    );

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

  const passRom =
    meta.imported !== undefined ||
    !(meta.once && isPrepared && choice.launched);
  const fill = (value: string) => fillRomPlaceholders(value, romPath);

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
