import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import type {
  RecompilationOs,
  RecompilationRef,
  RecompilationRelease,
  RecompilationReleases,
} from "@types";
import { HydraApi, logger } from "@main/services";
import { getRecompilationExecutableOverride } from "./recompilation-rom";
import type { PortPlatform } from "./recompilation-proton";

const ZIP_TAIL_BYTES = 66_000;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP_ENTRY_SIGNATURE = 0x02014b50;
const FOLDER_SCAN_DEPTH = 3;
const MIN_NAME_WORD_LENGTH = 3;
const INDEX_TIMEOUT_MS = 15_000;
const SKIPPED_PROGRAM = /(unins|setup|install|crash|vc_?redist|dxsetup)/;
// Words many recomps share say nothing about which one a program is.
const GENERIC_WORDS = new Set([
  "the",
  "recomp",
  "recompiled",
  "recomped",
  "decomp",
  "port",
  "edition",
  "launcher",
  "remastered",
  "public",
]);

const OS_BY_PLATFORM: Record<PortPlatform, RecompilationOs> = {
  win32: "windows",
  linux: "linux",
  darwin: "macos",
};

type NameMatcher = (fileName: string) => boolean;

const sameName =
  (expected: string): NameMatcher =>
  (fileName) =>
    fileName.toLowerCase() === expected.toLowerCase();

const leadingWord = (fileName: string) =>
  fileName.toLowerCase().split(/[^a-z0-9]+/)[0] ?? "";

/** An AppImage's name carries its version, so only its first word is kept. */
const sameAppImage =
  (assetName: string): NameMatcher =>
  (fileName) =>
    fileName.toLowerCase().endsWith(".appimage") &&
    leadingWord(fileName) === leadingWord(assetName);

const fetchRange = async (url: string, start: number, end: number) => {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
  });
  if (response.status !== 206) throw new Error(`No range: ${response.status}`);
  const total = Number(
    response.headers.get("content-range")?.split("/").at(-1) ?? Number.NaN
  );
  return { data: Buffer.from(await response.arrayBuffer()), total };
};

interface ZipEntry {
  name: string;
  crc32: number;
  size: number;
}

/** The files in a remote zip, read from its index without downloading it. */
const readZipEntries = async (
  url: string,
  size: number
): Promise<ZipEntry[] | null> => {
  const tailStart = Math.max(0, size - ZIP_TAIL_BYTES);
  const { data: tail } = await fetchRange(url, tailStart, size - 1);
  let end = -1;
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) === ZIP_END_SIGNATURE) {
      end = index;
      break;
    }
  }
  if (end < 0) return null;

  let indexSize = tail.readUInt32LE(end + 12);
  let indexStart = tail.readUInt32LE(end + 16);
  if (indexStart === 0xffffffff) {
    const zip64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]), end);
    if (zip64 < 0 || tail.readUInt32LE(zip64) !== ZIP64_END_SIGNATURE) {
      return null;
    }
    indexSize = Number(tail.readBigUInt64LE(zip64 + 40));
    indexStart = Number(tail.readBigUInt64LE(zip64 + 48));
  }

  const { data: index } = await fetchRange(
    url,
    indexStart,
    indexStart + indexSize - 1
  );
  const entries: ZipEntry[] = [];
  for (let offset = 0; offset + 46 <= index.length; ) {
    if (index.readUInt32LE(offset) !== ZIP_ENTRY_SIGNATURE) break;
    const nameLength = index.readUInt16LE(offset + 28);
    const extraLength = index.readUInt16LE(offset + 30);
    const commentLength = index.readUInt16LE(offset + 32);
    entries.push({
      name: index
        .toString("utf8", offset + 46, offset + 46 + nameLength)
        .replaceAll("\\", "/"),
      crc32: index.readUInt32LE(offset + 16),
      size: index.readUInt32LE(offset + 24),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const CACHE_MS = 10 * 60_000;
const zipIndexes = new Map<
  string,
  { at: number; result: Promise<ZipEntry[] | null> }
>();

const readZipEntriesCached = (url: string, size: number) => {
  const cached = zipIndexes.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const result = readZipEntries(url, size).catch(() => null);
  zipIndexes.set(url, { at: Date.now(), result });
  return result;
};

const releaseLists = new Map<
  string,
  { at: number; result: Promise<RecompilationRelease[]> }
>();

/** The releases Hydra knows of, newest first. */
const getReleasesCached = (ref: RecompilationRef) => {
  const key = `${ref.objectId}:${ref.slug}`;
  const cached = releaseLists.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  const result = HydraApi.get<RecompilationReleases>(
    `/games/launchbox/${encodeURIComponent(ref.objectId)}/recompilations/${encodeURIComponent(ref.slug)}/releases`,
    undefined,
    { needsAuth: false }
  ).then(({ releases }) =>
    [...releases].sort(
      (left, right) =>
        Number(right.isLatest) - Number(left.isLatest) ||
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    )
  );
  releaseLists.set(key, { at: Date.now(), result });
  result.catch(() => releaseLists.delete(key));
  return result;
};

const crc32File = (filePath: string) =>
  new Promise<number>((resolve, reject) => {
    let crc = 0;
    fs.createReadStream(filePath)
      .on("data", (chunk: Buffer | string) => {
        crc = zlib.crc32(chunk, crc);
      })
      .once("error", reject)
      .once("end", () => resolve(crc));
  });

const sha256File = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", () => resolve(hash.digest("hex")));
  });

// Builds for other machines or packagings than the one Hydra installs.
const OTHER_BUILD = /arm64|aarch64|flatpak|debug|symbols|source/i;

const VERSION_IN_NAME = /v?\d+(?:[._]\d+)+/gi;

/** An asset's name without its version, to find the same file in other releases. */
const assetKey = (name: string) =>
  name.toLowerCase().replaceAll(VERSION_IN_NAME, "");

/**
 * The files of a release that may hold the build Hydra installs. Only the
 * latest release marks it, so older ones are matched by OS, and the file
 * named like the latest one's is tried first.
 */
const pickReleaseAssets = (
  release: RecompilationRelease,
  platform: PortPlatform,
  latestKey: string | null
) => {
  const os = OS_BY_PLATFORM[platform];
  const marked = release.assets.find(
    (item) => item.isInstallTarget && item.os === os
  );
  if (marked) return [marked];
  const candidates = release.assets.filter(
    (item) => item.os === os && !OTHER_BUILD.test(item.name)
  );
  return [...candidates].sort(
    (left, right) =>
      Number(assetKey(right.name) === latestKey) -
      Number(assetKey(left.name) === latestKey)
  );
};

const getLatestKey = (
  releases: RecompilationRelease[],
  platform: PortPlatform
) => {
  const target = releases[0]?.assets.find(
    (item) => item.isInstallTarget && item.os === OS_BY_PLATFORM[platform]
  );
  return target ? assetKey(target.name) : null;
};

const listReleaseAssets = (
  releases: RecompilationRelease[],
  platform: PortPlatform
) => {
  const latestKey = getLatestKey(releases, platform);
  return releases.flatMap((release) =>
    pickReleaseAssets(release, platform, latestKey).map((asset) => ({
      release,
      asset,
    }))
  );
};

/** Reads every release's index at once, so finding the version is quick. */
export const warmReleaseIndexes = async (
  ref: RecompilationRef,
  platform: PortPlatform
) => {
  const releases = await getReleasesCached(ref).catch(() => []);
  for (const { asset } of listReleaseAssets(releases, platform)) {
    if (asset.name.toLowerCase().endsWith(".zip")) {
      void readZipEntriesCached(asset.url, asset.size);
    }
  }
};

/**
 * Which release a folder's program comes from, by its size and checksum in
 * the releases Hydra knows of. Null for a build Hydra doesn't know, such as
 * one newer than its list.
 */
export const identifyFolderVersion = async (
  ref: RecompilationRef,
  programPath: string,
  platform: PortPlatform,
  onProgress?: (loaded: number, total: number) => void
) => {
  try {
    const { size } = await fs.promises.stat(programPath);
    const programName = path.basename(programPath).toLowerCase();
    const candidates = listReleaseAssets(
      await getReleasesCached(ref),
      platform
    );
    let read = 0;
    onProgress?.(0, candidates.length || 1);
    const indexes = await Promise.all(
      candidates.map(({ asset }) =>
        (asset.name.toLowerCase().endsWith(".zip")
          ? readZipEntriesCached(asset.url, asset.size)
          : Promise.resolve(null)
        ).finally(() => {
          read += 1;
          onProgress?.(read, candidates.length);
        })
      )
    );

    let localCrc: number | null = null;
    let localSha: string | null = null;
    for (const [index, { release, asset }] of candidates.entries()) {
      const entries = indexes[index];
      if (entries) {
        const entry = entries.find(
          (item) =>
            item.size === size &&
            path.posix.basename(item.name).toLowerCase() === programName
        );
        if (!entry) continue;
        localCrc ??= await crc32File(programPath);
        if (entry.crc32 === localCrc) return release.version;
      } else if (asset.sha256 && asset.size === size) {
        localSha ??= await sha256File(programPath);
        if (localSha === asset.sha256) return release.version;
      }
    }
  } catch (error) {
    logger.warn(`Could not tell which ${ref.slug} release a folder is`, error);
  }
  return null;
};

const nameWords = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (word) => word.length >= MIN_NAME_WORD_LENGTH && !GENERIC_WORDS.has(word)
    );

const NOT_PROGRAMS = new Set(["license", "readme", "version", "changelog"]);

const isProgramName = (fileName: string, platform: PortPlatform) => {
  const lower = fileName.toLowerCase();
  if (SKIPPED_PROGRAM.test(lower)) return false;
  if (platform === "win32") return lower.endsWith(".exe");
  // Linux programs often have no extension at all.
  return (
    lower.endsWith(".appimage") ||
    lower.endsWith(".x86_64") ||
    (!lower.includes(".") && !NOT_PROGRAMS.has(lower))
  );
};

/** The program Hydra would launch from a release, picked the way installs do. */
const pickReleaseProgram = (
  names: string[],
  portName: string,
  platform: PortPlatform
) => {
  const words = nameWords(portName);
  const programs = names
    .filter((name) => !name.endsWith("/"))
    .filter((name) => isProgramName(path.posix.basename(name), platform));
  const depth = (name: string) => name.split("/").length;
  const matchesName = (name: string) =>
    words.some((word) =>
      path.posix.basename(name).toLowerCase().includes(word)
    );
  return (
    [...programs].sort(
      (left, right) =>
        depth(left) - depth(right) ||
        Number(matchesName(right)) - Number(matchesName(left)) ||
        left.localeCompare(right)
    )[0] ?? null
  );
};

const getReleaseProgram = async (
  ref: RecompilationRef,
  portName: string,
  platform: PortPlatform
): Promise<NameMatcher | null> => {
  try {
    const release = (await getReleasesCached(ref)).at(0) ?? null;
    const asset = release?.assets.find(
      (item) => item.isInstallTarget && item.os === OS_BY_PLATFORM[platform]
    );
    if (!asset) return null;

    const lower = asset.name.toLowerCase();
    if (lower.endsWith(".appimage")) return sameAppImage(asset.name);
    if (isProgramName(asset.name, platform)) return sameName(asset.name);
    if (!lower.endsWith(".zip")) return null;

    const entries = await readZipEntriesCached(asset.url, asset.size);
    const program =
      entries &&
      pickReleaseProgram(
        entries.map((entry) => entry.name),
        portName,
        platform
      );
    return program ? sameName(path.posix.basename(program)) : null;
  } catch (error) {
    logger.warn(
      `Could not read ${ref.slug}'s release to check a folder`,
      error
    );
    return null;
  }
};

const releasePrograms = new Map<
  string,
  { at: number; result: Promise<NameMatcher | null> }
>();

/** Kept a while, so the check is ready by the time a folder is picked. */
const getReleaseProgramCached = (
  ref: RecompilationRef,
  portName: string,
  platform: PortPlatform
) => {
  const key = `${ref.objectId}:${ref.slug}:${platform}`;
  const cached = releasePrograms.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.result;
  }
  const result = getReleaseProgram(ref, portName, platform);
  releasePrograms.set(key, { at: Date.now(), result });
  return result;
};

export const warmFolderCheck = (
  ref: RecompilationRef,
  portName: string,
  platforms: PortPlatform[]
) => {
  for (const platform of platforms) {
    void getReleaseProgramCached(ref, portName, platform);
    void warmReleaseIndexes(ref, platform);
  }
};

/**
 * What the port's program is called, from what Hydra already knows of it:
 * the program its info names and the one in its latest release.
 */
const getExpectedPrograms = async (
  ref: RecompilationRef,
  portName: string,
  platform: PortPlatform
) => {
  const override = getRecompilationExecutableOverride(ref.slug, platform);
  const fromRelease = await getReleaseProgramCached(ref, portName, platform);
  return [
    ...(override ? [sameName(path.basename(override))] : []),
    ...(fromRelease ? [fromRelease] : []),
  ];
};

const findFile = async (
  directory: string,
  matches: NameMatcher,
  depth = 0
): Promise<string | null> => {
  if (depth > FOLDER_SCAN_DEPTH) return null;
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && matches(entry.name)) {
      return path.join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const found = await findFile(
      path.join(directory, entry.name),
      matches,
      depth + 1
    );
    if (found) return found;
  }
  return null;
};

/** The folder itself, or the one folder inside it (a zip unpacked into its own folder). */
export const resolvePickedFolder = async (directory: string) => {
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  return visible.length === 1 && visible[0].isDirectory()
    ? path.join(directory, visible[0].name)
    : directory;
};

/**
 * Whether a picked folder holds this port: its known program is in it, or,
 * when that can't be told, a program named like the port.
 */
export const checkPickedFolder = async (
  ref: RecompilationRef,
  directory: string,
  portName: string,
  platforms: PortPlatform[]
) => {
  // The known name is checked first: it needs no download.
  for (const platform of platforms) {
    const override = getRecompilationExecutableOverride(ref.slug, platform);
    if (!override) continue;
    const found = await findFile(directory, sameName(path.basename(override)));
    if (found) return { fits: true, executablePath: found, platform };
  }

  for (const platform of platforms) {
    const expected = await getExpectedPrograms(ref, portName, platform);
    if (expected.length === 0) continue;
    const found = await findFile(directory, (fileName) =>
      expected.some((matches) => matches(fileName))
    );
    if (found) return { fits: true, executablePath: found, platform };
    return { fits: false, executablePath: null, platform };
  }

  const words = nameWords(portName);
  const named = await findFile(
    directory,
    (fileName) =>
      platforms.some((platform) => isProgramName(fileName, platform)) &&
      words.some((word) => fileName.toLowerCase().includes(word))
  );
  return {
    fits: named !== null,
    executablePath: named,
    platform: platforms[0],
  };
};
