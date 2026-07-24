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

export const parseCueReferencedFiles = async (
  cuePath: string
): Promise<string[]> => {
  try {
    const content = await fs.readFile(cuePath, "utf-8");
    const dir = path.dirname(cuePath);
    const matches = [...content.matchAll(/FILE\s+"(.+?)"\s+\w+/gi)];
    const resolved = await Promise.all(
      matches.map((m) => resolveCueRef(dir, m[1]))
    );
    return resolved.filter((p): p is string => p !== null);
  } catch {
    return [];
  }
};

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

export const resolveSniffTarget = async (
  filePath: string
): Promise<string | null> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".cue")) {
    const refs = await parseCueReferencedFiles(filePath);
    return refs[0] ?? null;
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
