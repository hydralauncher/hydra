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

export const parseCueReferencedFiles = async (
  cuePath: string
): Promise<string[]> => {
  try {
    const content = await fs.readFile(cuePath, "utf-8");
    const dir = path.dirname(cuePath);
    const matches = [...content.matchAll(/FILE\s+"(.+?)"\s+\w+/gi)];
    return matches.map((m) => path.resolve(dir, m[1]));
  } catch {
    return [];
  }
};

const replaceExt = (filePath: string, fromExt: string, toExt: string): string =>
  filePath.replace(new RegExp(`\\${fromExt}$`, "i"), toExt);

export const resolveSniffTarget = async (
  filePath: string
): Promise<string | null> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".cue")) {
    const refs = await parseCueReferencedFiles(filePath);
    return refs[0] ?? null;
  }
  if (lower.endsWith(".mds")) return replaceExt(filePath, ".mds", ".mdf");
  if (lower.endsWith(".ccd")) return replaceExt(filePath, ".ccd", ".img");
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
