import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export type EpicAchievementSource = "nemirtingas" | "alan-wake-2";

export interface EpicAchievementFile {
  filePath: string;
  source: EpicAchievementSource;
}

export interface EpicAchievementDiscovery {
  files: EpicAchievementFile[];
  ambiguous: boolean;
}

export interface EpicAchievementUnlock {
  externalId: string;
  unlockTime: number;
}

export interface EpicAchievementRoots {
  roaming: string[];
  local: string[];
}

const ALAN_WAKE_2_OBJECT_ID =
  "c4763f236d08423eb47b4c3008779c84:d59bd88b62394cdfa8e6911ec385f3dc";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_JSON_ROWS = 10_000;
const MAX_NEMIRTINGAS_SAVEPATH_LENGTH = 4096;
const MAX_EPIC_EXTERNAL_ID_LENGTH = 512;
const ALAN_WAKE_2_DISPLAY_NAME = "achievements";
const ALAN_WAKE_2_DISPLAY_NAME_BYTES = Buffer.byteLength(
  ALAN_WAKE_2_DISPLAY_NAME,
  "ascii"
);
const NORTHLIGHT_HEADER_BYTES = 8;
const NORTHLIGHT_RECORD_BYTES = 16;

type Candidate = EpicAchievementFile & { profileId: string };

async function uniqueCandidates(candidates: Candidate[]): Promise<Candidate[]> {
  const canonicalPaths = await Promise.all(
    candidates.map((candidate) =>
      realpath(candidate.filePath).catch(() => null)
    )
  );
  const paths = new Set<string>();
  const unique: Candidate[] = [];
  candidates.forEach((candidate, index) => {
    const canonicalPath = canonicalPaths[index];
    if (!canonicalPath || paths.has(canonicalPath)) return;
    paths.add(canonicalPath);
    unique.push(candidate);
  });
  return unique;
}

const isFile = async (filePath: string, maxBytes = MAX_FILE_BYTES) => {
  const info = await lstat(filePath).catch(() => null);
  return Boolean(
    info?.isFile() && !info.isSymbolicLink() && info.size <= maxBytes
  );
};

const isDirectory = async (directory: string) => {
  const info = await lstat(directory).catch(() => null);
  return Boolean(info?.isDirectory() && !info.isSymbolicLink());
};

async function findNemirtingasCandidates(
  roamingRoot: string,
  namespace: string
): Promise<Candidate[]> {
  const emulatorRoot = path.join(roamingRoot, "NemirtingasEpicEmu");
  if (!(await isDirectory(emulatorRoot))) return [];
  const profiles = await readdir(emulatorRoot, { withFileTypes: true }).catch(
    () => []
  );
  const candidates = await Promise.all(
    profiles.map(async (profile): Promise<Candidate | null> => {
      if (!profile.isDirectory() || profile.isSymbolicLink()) return null;
      const namespaceRoot = path.join(emulatorRoot, profile.name, namespace);
      if (!(await isDirectory(namespaceRoot))) return null;
      const filePath = path.join(namespaceRoot, "achievements.json");
      if (!(await isFile(filePath))) return null;
      return { filePath, source: "nemirtingas", profileId: profile.name };
    })
  );
  return candidates.filter((candidate): candidate is Candidate => !!candidate);
}

async function findAlanWake2Candidates(
  localRoot: string
): Promise<Candidate[]> {
  const gameRoot = path.join(localRoot, "Remedy", "AlanWake2");
  if (!(await isDirectory(gameRoot))) return [];
  const profiles = await readdir(gameRoot, { withFileTypes: true }).catch(
    () => []
  );
  const candidates = await Promise.all(
    profiles.map(async (profile): Promise<Candidate | null> => {
      if (!profile.isDirectory() || profile.isSymbolicLink()) return null;
      const achievementRoot = path.join(gameRoot, profile.name, "achievements");
      if (!(await isDirectory(achievementRoot))) return null;
      const filePath = path.join(achievementRoot, "data.chunk");
      const displayNamePath = path.join(
        achievementRoot,
        "--containerDisplayName.chunk"
      );
      if (
        !(await isFile(filePath)) ||
        !(await isFile(displayNamePath, ALAN_WAKE_2_DISPLAY_NAME_BYTES))
      )
        return null;
      const displayName = await readFile(displayNamePath).catch(() => null);
      if (displayName?.toString("ascii") !== ALAN_WAKE_2_DISPLAY_NAME)
        return null;
      return { filePath, source: "alan-wake-2", profileId: profile.name };
    })
  );
  return candidates.filter((candidate): candidate is Candidate => !!candidate);
}

/** Discover only one local player per source. Never union different profiles. */
export async function inspectEpicAchievementFilesInRoots(
  objectId: string,
  roots: EpicAchievementRoots,
  onWarning: (message: string) => void = () => {}
): Promise<EpicAchievementDiscovery> {
  const namespace = /^([a-f0-9]{32}):[a-f0-9]{32}$/i.exec(objectId)?.[1];
  if (!namespace) return { files: [], ambiguous: false };

  const nemirtingas = await uniqueCandidates(
    (
      await Promise.all(
        roots.roaming.map((root) => findNemirtingasCandidates(root, namespace))
      )
    ).flat()
  );
  const alanWake2 =
    objectId.toLowerCase() === ALAN_WAKE_2_OBJECT_ID
      ? await uniqueCandidates(
          (await Promise.all(roots.local.map(findAlanWake2Candidates))).flat()
        )
      : [];

  if (nemirtingas.length > 1)
    onWarning("Multiple Nemirtingas profiles found; skipping that source");
  if (alanWake2.length > 1)
    onWarning("Multiple Alan Wake 2 profiles found; skipping that source");

  const selectedNemirtingas = nemirtingas.length === 1 ? nemirtingas[0] : null;
  const selectedAlanWake2 = alanWake2.length === 1 ? alanWake2[0] : null;
  if (
    selectedNemirtingas &&
    selectedAlanWake2 &&
    selectedNemirtingas.profileId !== selectedAlanWake2.profileId
  ) {
    onWarning(
      "Epic achievement sources have different player profiles; skipping both sources"
    );
    return { files: [], ambiguous: true };
  }
  const files = [selectedNemirtingas, selectedAlanWake2]
    .filter((candidate): candidate is Candidate => candidate !== null)
    .map(({ filePath, source }) => ({ filePath, source }));
  return {
    files,
    ambiguous: nemirtingas.length > 1 || alanWake2.length > 1,
  };
}

export async function findEpicAchievementFilesInRoots(
  objectId: string,
  roots: EpicAchievementRoots,
  onWarning: (message: string) => void = () => {}
): Promise<EpicAchievementFile[]> {
  return (await inspectEpicAchievementFilesInRoots(objectId, roots, onWarning))
    .files;
}

function readStableFile(
  filePath: string,
  maxBytes = MAX_FILE_BYTES
): Uint8Array | null {
  let handle: number;
  try {
    handle = openSync(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
  } catch {
    return null;
  }
  try {
    const before = fstatSync(handle);
    if (!before.isFile() || before.size > maxBytes) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(
        handle,
        bytes,
        length,
        bytes.length - length,
        length
      );
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(handle);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      length !== after.size
    )
      return null;
    return bytes.subarray(0, length);
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
}

function parseNemirtingasSavepath(
  configPath: string,
  onWarning: (message: string) => void
): string | undefined | null {
  const bytes = readStableFile(configPath, MAX_CONFIG_BYTES);
  let parsed: unknown;
  try {
    if (!bytes) throw new Error("Incomplete configuration");
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    onWarning("Unreadable Nemirtingas configuration; skipping emulator state");
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    onWarning("Invalid Nemirtingas configuration; skipping emulator state");
    return null;
  }
  const savepath = (parsed as Record<string, unknown>).savepath;
  if (savepath === undefined || savepath === "appdata") return undefined;
  if (
    typeof savepath !== "string" ||
    savepath.length > MAX_NEMIRTINGAS_SAVEPATH_LENGTH
  ) {
    onWarning("Invalid Nemirtingas savepath; skipping emulator state");
    return null;
  }
  return savepath;
}

function staysWithinDirectory(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolveNemirtingasSaveRoot(
  gameDirectory: string,
  savepath: string,
  onWarning: (message: string) => void
): Promise<string | null> {
  const normalized = savepath.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(savepath) ||
    /^[a-zA-Z]:/u.test(normalized)
  ) {
    onWarning(
      "Absolute Nemirtingas savepath is unsupported; skipping emulator state"
    );
    return null;
  }
  const root = path.resolve(gameDirectory, normalized);
  if (!staysWithinDirectory(gameDirectory, root)) {
    onWarning(
      "Nemirtingas savepath leaves the game directory; skipping emulator state"
    );
    return null;
  }
  const [canonicalGameDirectory, canonicalRoot] = await Promise.all([
    realpath(gameDirectory).catch(() => null),
    realpath(root).catch(() => null),
  ]);
  if (
    canonicalGameDirectory &&
    canonicalRoot &&
    !staysWithinDirectory(canonicalGameDirectory, canonicalRoot)
  ) {
    onWarning(
      "Nemirtingas savepath resolves outside the game directory; skipping emulator state"
    );
    return null;
  }
  return root;
}

/** A configured path is relative to the game directory, per Nemirtingas. */
export async function getNemirtingasSaveRoot(
  executablePath: string | null,
  onWarning: (message: string) => void = () => {}
): Promise<string | undefined | null> {
  if (!executablePath || !path.isAbsolute(executablePath)) return undefined;
  const gameDirectory = path.dirname(executablePath);
  for (const configPath of [
    path.join(gameDirectory, "NemirtingasEpicEmu.json"),
    path.join(gameDirectory, "nepice_settings", "NemirtingasEpicEmu.json"),
  ]) {
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
    const savepath = parseNemirtingasSavepath(configPath, onWarning);
    if (savepath === null || savepath === undefined) return savepath;
    return resolveNemirtingasSaveRoot(gameDirectory, savepath, onWarning);
  }
  return undefined;
}

function parseNemirtingasState(
  bytes: Uint8Array,
  nowMs: number
): EpicAchievementUnlock[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length > MAX_JSON_ROWS) return null;

  const seen = new Set<string>();
  const unlocks: EpicAchievementUnlock[] = [];
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      !Object.hasOwn(row, "AchievementId") ||
      !Object.hasOwn(row, "UnlockTime")
    )
      return null;
    const { AchievementId: externalId, UnlockTime: seconds } = row as Record<
      string,
      unknown
    >;
    if (
      typeof externalId !== "string" ||
      !externalId.trim() ||
      externalId.length > MAX_EPIC_EXTERNAL_ID_LENGTH ||
      [...externalId].some(
        (character) => (character.codePointAt(0) ?? 0) < 32
      ) ||
      seen.has(externalId) ||
      typeof seconds !== "number" ||
      !Number.isSafeInteger(seconds) ||
      seconds < 0
    )
      return null;
    seen.add(externalId);
    if (seconds === 0) continue;
    const unlockTime = seconds * 1000;
    if (!Number.isSafeInteger(unlockTime) || unlockTime > nowMs) return null;
    unlocks.push({ externalId, unlockTime });
  }
  return unlocks;
}

const ALAN_WAKE_2_CATALOG_ID_RANGES = [
  { lastPosition: 38, idOffset: 0 },
  { lastPosition: 40, idOffset: 1 },
  { lastPosition: 66, idOffset: 3 },
  { lastPosition: 78, idOffset: 34 },
  { lastPosition: 88, idOffset: 122 },
] as const;

const expectedCatalogId = (position: number): number | null => {
  if (position < 1) return null;
  const range = ALAN_WAKE_2_CATALOG_ID_RANGES.find(
    ({ lastPosition }) => position <= lastPosition
  );
  return range ? position + range.idOffset : null;
};

// Verified against the 88-entry Alan Wake 2 catalog in LBX-1070. All other
// known entries require one step; entries beyond 88 have no verified threshold.
const multiStepThresholds: Readonly<Record<number, number>> = {
  10: 5,
  11: 6,
  12: 8,
  20: 5,
  34: 13,
  59: 17,
  60: 43,
  63: 14,
  69: 3,
  73: 6,
  81: 5,
  85: 4,
  87: 37,
};

function parseAlanWake2State(
  bytes: Uint8Array,
  nowMs: number
): EpicAchievementUnlock[] | null {
  if (bytes.byteLength < NORTHLIGHT_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 1) return null;
  const count = view.getUint32(4, true);
  if (
    bytes.byteLength !==
    NORTHLIGHT_HEADER_BYTES + count * NORTHLIGHT_RECORD_BYTES
  )
    return null;

  const unlocks: EpicAchievementUnlock[] = [];
  for (let index = 0; index < count; index++) {
    const offset = NORTHLIGHT_HEADER_BYTES + index * NORTHLIGHT_RECORD_BYTES;
    if (view.getUint32(offset, true) !== 2) return null;
    const position = index + 1;
    const catalogId = expectedCatalogId(position);
    if (catalogId !== null && view.getUint32(offset + 4, true) !== catalogId)
      return null;
    if (catalogId === null) continue;
    const stepsCurrent = view.getUint32(offset + 8, true);
    if (stepsCurrent >= (multiStepThresholds[position] ?? 1)) {
      // The API's Alan Wake 2 catalogue uses numeric external IDs.
      unlocks.push({ externalId: String(position), unlockTime: nowMs });
    }
  }
  return unlocks;
}

/** Null means the file was absent, changing, malformed, or unsupported. */
export function parseEpicAchievementFile(
  source: EpicAchievementSource,
  filePath: string
): EpicAchievementUnlock[] | null {
  const bytes = readStableFile(filePath);
  if (!bytes) return null;
  const nowMs = Date.now();
  if (source === "nemirtingas") return parseNemirtingasState(bytes, nowMs);
  if (source === "alan-wake-2") return parseAlanWake2State(bytes, nowMs);
  return null;
}
