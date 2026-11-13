import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import type {
  Download,
  RecompilationActionResult,
  RecompilationPrepareStep,
  RecompilationRef,
  RecompilationRomMeta,
  RecompilationRomSource,
  RecompilationRomState,
  User,
} from "@types";
import { isCompletedLikeDownload } from "../../../types";
import { db, downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { t } from "i18next";
import { logger, SevenZip, WindowManager } from "@main/services";
import { HydraApi } from "@main/services/hydra-api";
import { parseParamSfoValue } from "@main/services/emulators/param-sfo";
import {
  assertPs4UpdateFits,
  installPs4Pkg,
  isPs4PkgPath,
  Ps4PkgError,
  readPs4PkgInfo,
} from "@main/services/ps4-pkg";
import {
  getRecompilationBaseDirectory,
  getRecompilationInstallDirectory,
  parseRecompilationRef,
  readInstallMarker,
  resolveRecompilationPath,
} from "./recompilation-paths";
import recompilationMeta from "./recompilation-meta.json";
import {
  formatPs4Version,
  isPs4PkgJobRunning,
  runPs4PkgJob,
} from "../emulators/ps4-pkg-job";
import { toZ64 } from "./n64-rom";
import {
  getOnlineLaunchEnv,
  pickPortFile,
  writeIniValues,
} from "./recompilation-port-settings";
import {
  isPreparedForVersion,
  readInstallerEvent,
} from "./recompilation-prepare";

type MetaPlatform = "win32" | "linux";

const ROM_META = recompilationMeta as Record<
  string,
  | {
      rom: RecompilationRomMeta | null;
      hideConsole?: boolean;
      executable?: Partial<Record<MetaPlatform, string>>;
    }
  | undefined
>;

const getRecompilationRomMeta = (slug: string): RecompilationRomMeta | null =>
  (Object.hasOwn(ROM_META, slug) ? ROM_META[slug]?.rom : null) ?? null;

export const shouldHideRecompilationConsole = (slug: string) =>
  Object.hasOwn(ROM_META, slug) && ROM_META[slug]?.hideConsole === true;

export const getRecompilationExecutableOverride = (slug: string) =>
  (Object.hasOwn(ROM_META, slug)
    ? ROM_META[slug]?.executable?.[process.platform as MetaPlatform]
    : undefined) ?? null;

type RomKind = Pick<RecompilationRomMeta, "extensions" | "folder" | "titleIds">;

const EMPTY_ROM_KIND: RomKind = { extensions: [] };

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
  checkedFrom?: string;
  /** Port version the ROM was last prepared for, kept for ports with `prepareOnUpdate`. */
  preparedVersion?: string;
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

const isFolderRom = (kind: RomKind) => Boolean(kind.folder?.length);

const PS4_PARAM_SFO = path.join("sce_sys", "param.sfo");

// The shared reader returns values as SKUs ("CUSA-01623", "0109" for "01.09").
const toParamSfoKey = (value: string) =>
  value.replace(/[^A-Z0-9]/gi, "").toUpperCase();

const readParamSfoKey = async (directory: string, key: string) => {
  const data = await fs.promises
    .readFile(path.join(directory, PS4_PARAM_SFO))
    .catch(() => null);
  const value = data ? parseParamSfoValue(data, key) : null;
  return value ? toParamSfoKey(value) : null;
};

const readTitleId = (directory: string) =>
  readParamSfoKey(directory, "TITLE_ID");

/** A PS4 game folder is a version the port runs, when the port lists them. */
const isSupportedGameVersion = async (
  directory: string,
  meta: RecompilationRomMeta
) => {
  if (!meta.appVersions?.length) return true;
  const version = await readParamSfoKey(directory, "APP_VER");
  return (
    version !== null && meta.appVersions.map(toParamSfoKey).includes(version)
  );
};

/** A game kept as a folder (a PS4 dump) holds every file the port needs. */
const hasGameFiles = async (
  directory: string | null | undefined,
  kind: RomKind
) => {
  if (!directory) return false;
  try {
    if (!(await fs.promises.stat(directory)).isDirectory()) return false;
  } catch {
    return false;
  }
  for (const file of kind.folder ?? []) {
    if (!(await fileExists(path.join(directory, ...file.split("/"))))) {
      return false;
    }
  }
  return true;
};

/** When the port lists game IDs, the folder must be one of those games. */
const isPortGame = async (directory: string, kind: RomKind) => {
  if (!kind.titleIds?.length) return true;
  const titleId = await readTitleId(directory);
  return titleId !== null && kind.titleIds.includes(titleId);
};

const isGameFolder = async (
  directory: string | null | undefined,
  kind: RomKind
) =>
  (await hasGameFiles(directory, kind)) && (await isPortGame(directory!, kind));

/** The folder ports take the game's own eboot.bin too, and keep its folder. */
const toGameFolder = (romPath: string) =>
  path.basename(romPath).toLowerCase() === "eboot.bin"
    ? path.dirname(romPath)
    : romPath;

const romExists = (romPath: string | null | undefined, kind: RomKind) =>
  isFolderRom(kind) ? isGameFolder(romPath, kind) : fileExists(romPath);

const findGameFolder = async (
  directory: string,
  kind: RomKind,
  depth = 0
): Promise<string | null> => {
  if (await isGameFolder(directory, kind)) return directory;
  if (depth >= ROM_SCAN_DEPTH) return null;

  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findGameFolder(
      path.join(directory, entry.name),
      kind,
      depth + 1
    );
    if (found) return found;
  }
  return null;
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

const getDownloadedRomPath = async (download: Download, kind: RomKind) => {
  if (!download.folderName) return null;
  const downloaded = path.join(download.downloadPath, download.folderName);
  if (isFolderRom(kind)) return findGameFolder(downloaded, kind);
  const { extensions } = kind;
  if (await fileExists(downloaded)) {
    return hasExtension(downloaded, extensions) ||
      ARCHIVE_EXTENSIONS.has(path.extname(downloaded).toLowerCase())
      ? downloaded
      : null;
  }
  return (await findRomInFolder(downloaded, extensions))?.path ?? null;
};

const getLibraryRomPath = async (objectId: string, kind: RomKind) => {
  const key = levelKeys.game("launchbox", objectId);

  const download = await downloadsSublevel.get(key).catch(() => null);
  if (download && isCompletedLikeDownload(download)) {
    if (download.extracting) return null;
    const downloaded = await getDownloadedRomPath(download, kind);
    if (downloaded) return downloaded;
  } else if (
    download &&
    download.status !== "error" &&
    download.status !== "removed"
  ) {
    return null;
  }

  const game = await gamesSublevel.get(key).catch(() => null);
  if (!game || game.isDeleted) return null;
  const candidates = [
    game.selectedDiscPath,
    ...(game.discs ?? []).map((disc) => disc.path),
  ];
  for (const disc of candidates) {
    if (!disc) continue;
    const matches = isFolderRom(kind) || hasExtension(disc, kind.extensions);
    if (matches && (await romExists(disc, kind))) return disc;
  }
  return null;
};

const getCopyTarget = (
  meta: RecompilationRomMeta,
  baseDirectory: string,
  romName: string
) => {
  const template = meta.copyTo?.[process.platform as MetaPlatform];
  return template
    ? resolveRecompilationPath(template, baseDirectory, romName)
    : null;
};

const isPortReady = async (
  meta: RecompilationRomMeta,
  baseDirectory: string,
  choice: RomChoice | null
) => {
  const imported = meta.imported?.[process.platform as MetaPlatform] ?? [];
  for (const template of imported) {
    if (
      await fileExists(resolveRecompilationPath(template, baseDirectory, ""))
    ) {
      return true;
    }
  }
  return (
    getCopyTarget(meta, baseDirectory, "") !== null &&
    (await fileExists(choice?.preparedTarget))
  );
};

const isPreparedForInstalledVersion = async (
  meta: RecompilationRomMeta,
  installDirectory: string,
  choice: RomChoice | null,
  romPath: string | null
) =>
  meta.prepareOnUpdate === true &&
  isPreparedForVersion(
    meta,
    choice,
    romPath,
    (await readInstallMarker(installDirectory))?.version
  );

export const getRecompilationRomState = async (
  rawRef: unknown
): Promise<RecompilationRomState | null> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return null;

  const meta = getRecompilationRomMeta(ref.slug);
  const kind = meta ?? EMPTY_ROM_KIND;
  const installDirectory = await getRecompilationInstallDirectory(ref.slug);
  const [choice, libraryRomPath] = await Promise.all([
    readRomChoice(installDirectory),
    getLibraryRomPath(ref.objectId, kind),
  ]);

  let romPath: string | null = null;
  if (choice?.source === "file" && (await romExists(choice.path, kind))) {
    romPath = choice.path!;
  } else if (choice?.source === "library") {
    romPath = libraryRomPath;
  }

  return {
    handlesRom: meta !== null,
    source: choice?.source ?? null,
    romPath,
    libraryRomPath,
    needsPreparation: Boolean(meta?.path?.installer),
    isFolder: isFolderRom(kind),
    isReady: meta
      ? (await isPortReady(
          meta,
          await getRecompilationBaseDirectory(installDirectory),
          choice
        )) ||
        (await isPreparedForInstalledVersion(
          meta,
          installDirectory,
          choice,
          romPath
        ))
      : false,
    extensions: (meta?.extensions ?? []).map((extension) => extension.slice(1)),
  };
};

const checkChosenRom = async (
  source: unknown,
  romPath: unknown,
  meta: RecompilationRomMeta
): Promise<RecompilationActionResult | null> => {
  if (source === "library") return null;
  if (source !== "file") return { ok: false, reason: "invalid_rom" };
  if (typeof romPath !== "string" || !fs.existsSync(romPath)) {
    return { ok: false, reason: "rom_not_found" };
  }

  if (isFolderRom(meta)) {
    if (!(await hasGameFiles(romPath, meta))) {
      // An update or patch folder has the eboot.bin but not the whole game.
      const hasEboot = await fileExists(path.join(romPath, "eboot.bin"));
      return {
        ok: false,
        reason: hasEboot ? "rom_not_full_game" : "rom_wrong_format",
      };
    }
    return (await isPortGame(romPath, meta))
      ? null
      : { ok: false, reason: "rom_other_game" };
  }

  const isValid =
    (await fileExists(romPath)) && hasExtension(romPath, meta.extensions);
  return isValid ? null : { ok: false, reason: "rom_wrong_format" };
};

const toChosenPath = (rawPath: unknown, meta: RecompilationRomMeta) =>
  typeof rawPath === "string" && isFolderRom(meta)
    ? toGameFolder(rawPath)
    : rawPath;

const getChosenGameFolder = async (
  ref: RecompilationRef,
  meta: RecompilationRomMeta
) => {
  const choice = await readRomChoice(
    await getRecompilationInstallDirectory(ref.slug)
  );
  const folder =
    choice?.source === "library"
      ? await getLibraryRomPath(ref.objectId, meta)
      : choice?.source === "file"
        ? choice.path
        : null;
  return folder && (await isGameFolder(folder, meta)) ? folder : null;
};

const checkChosenPkg = async (
  ref: RecompilationRef,
  pkgPath: string,
  meta: RecompilationRomMeta
): Promise<RecompilationActionResult | null> => {
  if (!fs.existsSync(pkgPath)) return { ok: false, reason: "rom_not_found" };

  const info = await readPs4PkgInfo(pkgPath).catch(() => null);
  if (
    !info ||
    info.isDeltaPatch ||
    (info.kind !== "game" && info.kind !== "patch")
  ) {
    return { ok: false, reason: "rom_wrong_format" };
  }
  if (meta.titleIds?.length && !meta.titleIds.includes(info.titleId)) {
    return { ok: false, reason: "rom_other_game" };
  }
  if (info.kind === "patch") {
    const gameFolder = await getChosenGameFolder(ref, meta);
    if (!gameFolder) return { ok: false, reason: "rom_update_needs_game" };
    try {
      await assertPs4UpdateFits(info, gameFolder);
    } catch (error) {
      return { ok: false, reason: toPkgFailureReason(error) };
    }
  }
  return null;
};

const PKG_FAILURE_REASONS: Record<string, string> = {
  no_space: "rom_pkg_no_space",
  cancelled: "rom_pkg_cancelled",
  missing_base_game: "rom_update_needs_game",
  other_game: "rom_other_game",
  not_newer: "rom_pkg_not_newer",
  keys_unavailable: "rom_pkg_keys_unavailable",
};

function toPkgFailureReason(error: unknown) {
  const code = error instanceof Ps4PkgError ? error.code : "failed";
  return PKG_FAILURE_REASONS[code] ?? "rom_pkg_failed";
}

/**
 * Extracts a PS4 game or update PKG picked in the install modal. It runs as
 * the shared PKG job, like any other extraction: it shows in Downloads, the
 * modal can be closed, and the ROM is chosen for the port when it ends.
 */
export const extractRecompilationRomPkg = async (
  rawRef: unknown,
  rawPath: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  const meta = ref ? getRecompilationRomMeta(ref.slug) : null;
  if (!ref || !meta || !isFolderRom(meta)) {
    return { ok: false, reason: "invalid_port" };
  }
  if (typeof rawPath !== "string" || !isPs4PkgPath(rawPath)) {
    return { ok: false, reason: "rom_wrong_format" };
  }
  if (isPs4PkgJobRunning()) return { ok: false, reason: "rom_pkg_busy" };

  const problem = await checkChosenPkg(ref, rawPath, meta);
  if (problem) return problem;

  const info = await readPs4PkgInfo(rawPath);
  const { isPs4GameRunning } = await import("../emulators/ps4-pkg-actions");
  if (
    info.kind === "patch" &&
    (await isPs4GameRunning("launchbox", ref.objectId))
  ) {
    return { ok: false, reason: "rom_game_running" };
  }
  const gameDirectory = await getChosenGameFolder(ref, meta);
  // Checked again right before starting: another job may have begun while
  // the PKG was being read.
  if (isPs4PkgJobRunning()) return { ok: false, reason: "rom_pkg_busy" };
  void runPs4PkgJob(
    "launchbox",
    ref.objectId,
    info.kind === "patch" ? "update" : "extract",
    {},
    async (signal, onProgress) => {
      const installed = await installPs4Pkg({
        pkgPath: rawPath,
        gameDirectory,
        onProgress,
        signal,
      });
      await setRecompilationRom(ref, {
        source: "file",
        path: installed.gameDirectory,
      });
      return { version: formatPs4Version(info.appVersion) };
    }
  );
  return { ok: true };
};

/** Checks a file picked in the install modal without saving it. */
export const checkRecompilationRom = async (
  rawRef: unknown,
  rawPath: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  const meta = ref ? getRecompilationRomMeta(ref.slug) : null;
  if (!ref || !meta) return { ok: false, reason: "invalid_port" };
  if (
    typeof rawPath === "string" &&
    isFolderRom(meta) &&
    isPs4PkgPath(rawPath)
  ) {
    const problem = await checkChosenPkg(ref, rawPath, meta);
    if (problem) return problem;
    const info = await readPs4PkgInfo(rawPath).catch(() => null);
    return { ok: true, isUpdate: info?.kind === "patch" };
  }
  const chosenPath = toChosenPath(rawPath, meta);
  const problem = await checkChosenRom("file", chosenPath, meta);
  if (problem) return problem;
  return isFolderRom(meta) && typeof chosenPath === "string"
    ? { ok: true, path: chosenPath }
    : { ok: true };
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

  const { source, path: rawRomPath } = (rawChoice ?? {}) as Record<
    string,
    unknown
  >;
  const romPath = toChosenPath(rawRomPath, meta);
  const problem = await checkChosenRom(source, romPath, meta);
  if (problem) return problem;

  const installDirectory = await getRecompilationInstallDirectory(ref.slug);
  const previous = await readRomChoice(installDirectory);
  const chosenPath =
    source === "file"
      ? (romPath as string)
      : await getLibraryRomPath(ref.objectId, meta);
  const isChecked =
    chosenPath !== null &&
    (isFolderRom(meta) ||
      !ARCHIVE_EXTENSIONS.has(path.extname(chosenPath).toLowerCase()));
  await writeRomChoice(installDirectory, {
    preparedFrom: previous?.preparedFrom,
    preparedTarget: previous?.preparedTarget,
    preparedVersion: previous?.preparedVersion,
    launched: false,
    // checkChosenRom only lets "file" and "library" through.
    source: source as RecompilationRomSource,
    path: source === "file" ? (romPath as string) : undefined,
    checkedFrom: isChecked ? chosenPath : undefined,
  });

  const supported = isChecked
    ? await isSupportedRomVersion(chosenPath, meta)
    : true;
  if (supported) return { ok: true };
  return meta.requireAppVersion
    ? {
        ok: true,
        warning: "rom_update_required",
        requiredVersion: getRequiredVersionLabel(meta),
      }
    : { ok: true, warning: "rom_version" };
};

const MAX_HASHED_ROM_BYTES = 128 * 1024 * 1024;

const isSupportedRomVersion = async (
  romPath: string,
  meta: RecompilationRomMeta
) => {
  if (isFolderRom(meta)) return isSupportedGameVersion(romPath, meta);
  if (!meta.sha1?.length) return true;
  if (ARCHIVE_EXTENSIONS.has(path.extname(romPath).toLowerCase())) return true;

  try {
    const { size } = await fs.promises.stat(romPath);
    if (size > MAX_HASHED_ROM_BYTES) return true;

    const data = await fs.promises.readFile(romPath);
    // Identifies the ROM dump against the hashes the ports publish; not a security check.
    const sha1 = (bytes: Buffer) =>
      crypto.createHash("sha1").update(bytes).digest("hex"); // NOSONAR
    if (meta.sha1.includes(sha1(data))) return true;

    const isN64 = meta.extensions.includes(".z64");
    return isN64 && meta.sha1.includes(sha1(toZ64(data)));
  } catch (error) {
    logger.warn("Failed to check the ROM version", error);
    return true;
  }
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
  baseDirectory: string,
  romPath: string
) => {
  const copyTarget = getCopyTarget(meta, baseDirectory, path.basename(romPath));
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

const PORT_EXECUTABLE = "{exe}";

const findInstallerExecutable = async (
  name: string,
  installDirectory: string
) => {
  if (name === PORT_EXECUTABLE) {
    return (await readInstallMarker(installDirectory))?.executablePath ?? null;
  }
  const candidates =
    process.platform === "win32" ? [`${name}.exe`, name] : [name];
  return (
    candidates
      .map((candidate) => path.join(installDirectory, candidate))
      .find((candidate) => fs.existsSync(candidate)) ?? null
  );
};

const runRomInstaller = async (
  command: string[],
  installDirectory: string,
  romPath: string,
  onStep?: (step: RecompilationPrepareStep) => void
) => {
  const [name, ...args] = command;
  const executable = await findInstallerExecutable(name, installDirectory);

  return new Promise<void>((resolve, reject) => {
    if (!executable) {
      reject(new Error(`ROM installer ${name} not found`));
      return;
    }

    const child = spawn(
      executable,
      args.map((arg) => fillRomPlaceholders(arg, romPath)),
      {
        cwd: installDirectory,
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
      }
    );
    let current: RecompilationPrepareStep = {};
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const next = readInstallerEvent(line.trim(), current);
      if (!next) return;
      current = next;
      onStep?.(next);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ROM installer exited with ${code}`))
    );
  });
};

const writeRomConfig = async (
  config: NonNullable<NonNullable<RecompilationRomMeta["path"]>["config"]>,
  baseDirectory: string,
  romPath: string
) => {
  const template =
    typeof config.file === "string"
      ? config.file
      : config.file[process.platform as MetaPlatform];
  if (!template) return;
  const file = resolveRecompilationPath(template, baseDirectory, "");
  if (path.extname(file).toLowerCase() === ".ini") {
    await writeIniValues(file, { [config.key.at(-1)!]: romPath });
    return;
  }
  let root: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, "utf-8"));
    if (parsed && typeof parsed === "object") root = parsed;
  } catch {
    root = {};
  }

  const parentKeys = config.key.slice(0, -1);
  let node = root;
  for (const key of parentKeys) {
    const next = node[key];
    node[key] =
      next && typeof next === "object" && !Array.isArray(next) ? next : {};
    node = node[key] as Record<string, unknown>;
  }
  node[config.key.at(-1)!] = romPath;

  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(root, null, 2));
};

const getPortName = async (installDirectory: string) =>
  (await readInstallMarker(installDirectory))?.name ??
  path.basename(installDirectory);

const warnUnsupportedRom = async (installDirectory: string) => {
  const name = await getPortName(installDirectory);
  WindowManager.mainWindow?.webContents.send("on-show-toast", {
    type: "warning",
    title: t("rom_version_warning", { ns: "recompilation", name }),
  });
};

const getRequiredVersionLabel = (meta: RecompilationRomMeta) =>
  (meta.appVersions?.[0] ?? "").replace(/^0+(?=\d)/, "");

const refuseOutdatedGame = async (
  installDirectory: string,
  meta: RecompilationRomMeta
) => {
  WindowManager.mainWindow?.webContents.send("on-show-toast", {
    type: "error",
    title: t("rom_update_required", {
      ns: "recompilation",
      name: await getPortName(installDirectory),
      version: getRequiredVersionLabel(meta),
    }),
  });
};

const writePortSettings = async (
  meta: RecompilationRomMeta,
  baseDirectory: string
) => {
  for (const setting of meta.path?.settings ?? []) {
    const template = pickPortFile(setting.file);
    if (!template) continue;
    const file = resolveRecompilationPath(template, baseDirectory, "");
    if (setting.seedFrom && !(await fileExists(file))) {
      const seed = resolveRecompilationPath(
        setting.seedFrom,
        baseDirectory,
        ""
      );
      if (await fileExists(seed)) {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.copyFile(seed, file);
      }
    }
    await writeIniValues(file, setting.values);
  }
};

const getHydraAccount = async () => {
  if (!HydraApi.isLoggedIn()) return null;
  const user = await db
    .get<string, User | null>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  return user?.displayName ? { displayName: user.displayName } : null;
};

/** A port that rebuilds the game per version prepares again right after an update. */
export const shouldPrepareAfterUpdate = async (ref: RecompilationRef) => {
  if (!getRecompilationRomMeta(ref.slug)?.prepareOnUpdate) return false;
  return Boolean((await getRecompilationRomState(ref))?.romPath);
};

export type RecompilationLaunch =
  | { ok: true; args: string[]; env: Record<string, string> }
  | { ok: false; reason: string };

export const prepareRecompilationRom = async (
  ref: RecompilationRef,
  installDirectory: string,
  onStep?: (step: RecompilationPrepareStep) => void
): Promise<RecompilationLaunch> => {
  const meta = getRecompilationRomMeta(ref.slug);
  if (!meta) return { ok: true, args: [], env: {} };

  const state = await getRecompilationRomState(ref);
  const choice = await readRomChoice(installDirectory);

  const isNewRom =
    Boolean(state?.romPath) && choice?.preparedFrom !== state?.romPath;
  // Ports prepared per version are ready yet still need their launch arguments.
  if (state?.isReady && !isNewRom && !meta.prepareOnUpdate) {
    return { ok: true, args: [], env: {} };
  }

  if (!state?.romPath || !choice) return { ok: false, reason: "no_rom" };

  const portVersion = meta.prepareOnUpdate
    ? ((await readInstallMarker(installDirectory))?.version ?? undefined)
    : choice.preparedVersion;
  const isPrepared =
    choice.preparedFrom === state.romPath &&
    choice.preparedVersion === portVersion;
  let romPath = state.romPath;

  if (
    meta.requireAppVersion &&
    isFolderRom(meta) &&
    !(await isSupportedGameVersion(state.romPath, meta))
  ) {
    await refuseOutdatedGame(installDirectory, meta);
    return { ok: false, reason: "rom_update_required" };
  }

  let onlineEnv: Record<string, string> = {};

  try {
    if (isFolderRom(meta)) {
      // A game folder is used where it is: nothing to unpack or copy.
    } else if (!isPrepared || !(await fileExists(romPath))) {
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

    const baseDirectory = await getRecompilationBaseDirectory(installDirectory);
    const target = getRomTarget(meta, installDirectory, baseDirectory, romPath);
    if (target && (!isPrepared || !(await fileExists(target)))) {
      await copyRom(romPath, target, meta.format);
    }
    const sourceRomPath = romPath;
    if (target) romPath = target;
    await removeStaleRomTarget(
      installDirectory,
      choice.preparedTarget,
      target,
      sourceRomPath
    );

    if (meta.path?.installer && (!isPrepared || meta.imported)) {
      await runRomInstaller(
        meta.path.installer,
        installDirectory,
        romPath,
        onStep
      );
    }
    if (meta.path?.config) {
      await writeRomConfig(meta.path.config, baseDirectory, romPath);
    }
    await writePortSettings(meta, baseDirectory);
    if (meta.path?.online) {
      onlineEnv = await getOnlineLaunchEnv(
        meta.path.online,
        (template) => resolveRecompilationPath(template, baseDirectory, ""),
        await getHydraAccount()
      );
    }

    // ROMs downloaded or picked inside an archive are only checked once they are unpacked.
    const needsVersionCheck = choice.checkedFrom !== state.romPath;
    if (
      needsVersionCheck &&
      !(await isSupportedRomVersion(sourceRomPath, meta))
    ) {
      await warnUnsupportedRom(installDirectory);
    }

    if (
      !isPrepared ||
      needsVersionCheck ||
      (target ?? undefined) !== choice.preparedTarget
    ) {
      await writeRomChoice(installDirectory, {
        ...choice,
        checkedFrom: state.romPath,
        preparedFrom: state.romPath,
        preparedTarget: target ?? undefined,
        preparedVersion: portVersion,
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
    env: {
      ...(passRom
        ? Object.fromEntries(
            Object.entries(meta.path?.env ?? {}).map(([key, value]) => [
              key,
              fill(value),
            ])
          )
        : {}),
      ...onlineEnv,
    },
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

/** The PS4 game folder a folder port uses, or null when it has none. */
export const getRecompilationGameFolder = async (
  objectId: string,
  slug: string
) => {
  const meta = getRecompilationRomMeta(slug);
  if (!meta || !isFolderRom(meta)) return null;
  const state = await getRecompilationRomState({ objectId, slug });
  return state?.romPath ? toGameFolder(state.romPath) : null;
};

/**
 * Game folders of the PS4 ports installed for this game. Each port records
 * its game in the install marker, so this works when the game is not in the
 * library.
 */
export const listRecompilationGameFolders = async (objectId: string) => {
  const folders: string[] = [];
  for (const slug of Object.keys(ROM_META)) {
    const meta = getRecompilationRomMeta(slug);
    if (!meta || !isFolderRom(meta)) continue;
    const installDirectory = await getRecompilationInstallDirectory(slug);
    const marker = await readInstallMarker(installDirectory).catch(() => null);
    if (marker?.objectId !== objectId) continue;
    const folder = await getRecompilationGameFolder(objectId, slug);
    if (folder) folders.push(folder);
  }
  return folders;
};

export const getRecompilationChosenTitleId = async (ref: RecompilationRef) => {
  const folder = await getRecompilationGameFolder(ref.objectId, ref.slug);
  return folder ? readTitleId(folder) : null;
};
