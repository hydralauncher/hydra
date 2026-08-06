import { promises as fs } from "node:fs";
import path from "node:path";

const SNIFF_BYTES = 16 * 1024 * 1024;

export type DiscPlatform = "ps1" | "ps2" | "ps3" | "unknown";

const BOOT2_RE = /BOOT2\s*=/;
const BOOT_RE = /BOOT\s*=/;
const PS3_MARKERS = ["PS3_GAME", "PS3_DISC.SFB", "PARAM.SFO", "EBOOT.BIN"];

export const sniffDiscImage = async (
  filePath: string
): Promise<DiscPlatform> => {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, SNIFF_BYTES, 0);
    const text = buffer.subarray(0, bytesRead).toString("latin1");

    let ps3Hits = 0;
    for (const marker of PS3_MARKERS) {
      if (text.includes(marker)) ps3Hits += 1;
    }
    if (ps3Hits >= 2) return "ps3";

    if (BOOT2_RE.test(text)) return "ps2";
    if (BOOT_RE.test(text)) return "ps1";

    if (ps3Hits >= 1) return "ps3";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    await fh?.close();
  }
};

const resolveCueRef = async (
  dir: string,
  ref: string
): Promise<string | null> => {
  const base = path.basename(ref.replaceAll("\\", "/"));
  const resolved = path.resolve(dir, base);

  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    try {
      const entries = await fs.readdir(dir);
      const match = entries.find(
        (entry) => entry.toLowerCase() === base.toLowerCase()
      );
      if (match) return path.resolve(dir, match);
    } catch {
      return null;
    }
    return null;
  }
};

const decodeCueText = (raw: Buffer): string => {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString("utf16le");
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return raw.subarray(2).swap16().toString("utf16le");
  }
  if (
    raw.length >= 3 &&
    raw[0] === 0xef &&
    raw[1] === 0xbb &&
    raw[2] === 0xbf
  ) {
    return raw.subarray(3).toString("utf-8");
  }
  return raw.toString("utf-8");
};

const CUE_FILE_TYPES = "BINARY|MOTOROLA|MOTOROLLA|AIFF|WAVE|MP3|FLAC";
const CUE_FILE_LINE_RE = new RegExp(
  `^[^\\S\\r\\n]*FILE[^\\S\\r\\n]+(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|(.+?))[^\\S\\r\\n]*(?:${CUE_FILE_TYPES})?[^\\S\\r\\n]*$`,
  "gim"
);
const CUE_TRACK_LINE_RE = /^[^\S\r\n]*TRACK[^\S\r\n]+\S+[^\S\r\n]+(\S+)/gim;

export interface CueTrackFile {
  filePath: string;
  hasDataTrack: boolean;
}

const parseCueEntries = (content: string): { ref: string; at: number }[] => {
  CUE_FILE_LINE_RE.lastIndex = 0;
  const entries: { ref: string; at: number }[] = [];
  for (const m of content.matchAll(CUE_FILE_LINE_RE)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (ref) entries.push({ ref, at: m.index ?? 0 });
  }
  return entries;
};

const dataTrackOffsets = (content: string): number[] => {
  CUE_TRACK_LINE_RE.lastIndex = 0;
  const offsets: number[] = [];
  for (const m of content.matchAll(CUE_TRACK_LINE_RE)) {
    if (m[1].toUpperCase() !== "AUDIO") offsets.push(m.index ?? 0);
  }
  return offsets;
};

export const parseCueTrackFiles = async (
  cuePath: string
): Promise<CueTrackFile[]> => {
  try {
    const content = decodeCueText(await fs.readFile(cuePath));
    const dir = path.dirname(cuePath);
    const entries = parseCueEntries(content);
    const dataOffsets = dataTrackOffsets(content);

    const resolved = await Promise.all(
      entries.map((entry) => resolveCueRef(dir, entry.ref))
    );

    return entries.flatMap((entry, i) => {
      const filePath = resolved[i];
      if (!filePath) return [];
      const next = entries[i + 1]?.at ?? Number.MAX_SAFE_INTEGER;
      const hasDataTrack = dataOffsets.some(
        (offset) => offset > entry.at && offset < next
      );
      return [{ filePath, hasDataTrack }];
    });
  } catch {
    return [];
  }
};

export const parseCueReferencedFiles = async (
  cuePath: string
): Promise<string[]> =>
  (await parseCueTrackFiles(cuePath)).map((t) => t.filePath);

export const resolveSidecarWithExt = async (
  filePath: string,
  targetExt: string
): Promise<string | null> => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const expected = `${base}${targetExt}`;
  const direct = path.join(dir, expected);

  try {
    await fs.access(direct);
    return direct;
  } catch {
    const entries = await fs.readdir(dir).catch(() => null);
    if (!entries) return null;
    const wanted = expected.toLowerCase();
    const match = entries.find((entry) => entry.toLowerCase() === wanted);
    return match ? path.join(dir, match) : null;
  }
};

const TRACK_MARKER_RE = /^(.*\S)\s*[([]\s*(?:track|trk)\s*(\d+)\s*[)\]]$/i;

export const splitTrackMarker = (
  baseName: string
): { base: string; track: number } | null => {
  const match = TRACK_MARKER_RE.exec(baseName);
  if (!match) return null;
  const track = Number.parseInt(match[2], 10);
  return Number.isFinite(track) ? { base: match[1], track } : null;
};

const TRACK_SIDECAR_EXTS = [".bin", ".img"];

export const resolveTrackSiblings = async (
  filePath: string
): Promise<string[]> => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const entries = await fs.readdir(dir).catch(() => null);
  if (!entries) return [];

  const found: { filePath: string; track: number }[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!TRACK_SIDECAR_EXTS.includes(ext)) continue;

    const entryBase = path.basename(entry, path.extname(entry));
    if (entryBase.toLowerCase() === base) {
      found.push({ filePath: path.join(dir, entry), track: 1 });
      continue;
    }

    const split = splitTrackMarker(entryBase);
    if (split && split.base.toLowerCase() === base) {
      found.push({ filePath: path.join(dir, entry), track: split.track });
    }
  }

  return found.sort((a, b) => a.track - b.track).map((f) => f.filePath);
};

export const resolveSniffTarget = async (
  filePath: string
): Promise<string | null> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".cue")) {
    const tracks = await parseCueTrackFiles(filePath);
    const preferred = tracks.find((t) => t.hasDataTrack) ?? tracks[0];
    if (preferred) return preferred.filePath;
    return (await resolveTrackSiblings(filePath))[0] ?? null;
  }
  if (lower.endsWith(".mds")) return resolveSidecarWithExt(filePath, ".mdf");
  if (lower.endsWith(".ccd")) return resolveSidecarWithExt(filePath, ".img");
  if (
    lower.endsWith(".iso") ||
    lower.endsWith(".img") ||
    lower.endsWith(".bin") ||
    lower.endsWith(".mdf")
  ) {
    return filePath;
  }
  return null;
};
