import axios from "axios";
import fs from "node:fs";
import path from "node:path";

const MAX_CONCURRENT_DOWNLOADS = 4;
const MAX_CACHE_FILES = 256;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_REDIRECTS = 5;

export type ImageExtension = "png" | "jpeg" | "webp";

/**
 * Detects the real image format from magic bytes. Remote cover URLs
 * (steamstatic/steamgriddb) carry correct extensions today, but the
 * bytes are authoritative — a 404 page or HTML error must be discarded.
 */
export const sniffImageExt = (bytes: Buffer): ImageExtension | null => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

async function withConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    }
  );
  await Promise.all(lanes);
}

/**
 * Local cache of downloaded remote covers for the Moonlight app list.
 * Layout: `<dir>/<appid>.<ext>` plus a `<dir>/<appid>.<ext>.url` sidecar
 * holding the source URL, so a changed cover URL re-downloads and stale
 * files are removed. Files are read fresh by the sidecar per request.
 */
export class StreamCoverCache {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private filesForApp(appid: number): string[] {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return entries
      .filter(
        (entry) =>
          entry === `${appid}.png` ||
          entry === `${appid}.jpeg` ||
          entry === `${appid}.webp`
      )
      .map((entry) => path.join(this.dir, entry));
  }

  private removeFiles(files: string[]) {
    for (const file of files) {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.url`, { force: true });
    }
  }

  /**
   * Returns the local cover file for a game, downloading it when missing
   * or when the source URL changed. Null when the cover is unavailable
   * or the download does not look like an image.
   */
  public async resolve(
    appid: number,
    sourceUrl: string
  ): Promise<string | null> {
    const existing = this.filesForApp(appid);
    const fresh = existing.find((file) => {
      try {
        return (
          fs.statSync(file).size > 0 &&
          fs.readFileSync(`${file}.url`, "utf-8") === sourceUrl
        );
      } catch {
        return false;
      }
    });

    if (fresh) return fresh;
    this.removeFiles(existing);

    try {
      const response = await axios.get(sourceUrl, {
        responseType: "arraybuffer",
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxRedirects: MAX_DOWNLOAD_REDIRECTS,
      });
      const bytes = Buffer.from(response.data);
      const ext = sniffImageExt(bytes);
      if (!ext) return null;

      const file = path.join(this.dir, `${appid}.${ext}`);
      await fs.promises.writeFile(file, bytes);
      await fs.promises.writeFile(`${file}.url`, sourceUrl);
      return file;
    } catch {
      return null;
    }
  }

  /** Resolves many covers with bounded concurrency; never throws. */
  public async resolveAll(
    requests: { appid: number; url: string }[]
  ): Promise<Map<number, string>> {
    const resolved = new Map<number, string>();
    await withConcurrency(
      requests,
      MAX_CONCURRENT_DOWNLOADS,
      async ({ appid, url }) => {
        const file = await this.resolve(appid, url);
        if (file) resolved.set(appid, file);
      }
    );
    this.prune(resolved);
    return resolved;
  }

  /**
   * Bound the cache: drop covers that no longer belong to the synced
   * catalog (orphans) and enforce a file cap by oldest mtime. Runs
   * synchronously after every sync; failures are non-fatal.
   */
  private prune(resolved: Map<number, string>) {
    const keep = new Set<string>();
    for (const file of resolved.values()) {
      keep.add(path.basename(file));
      keep.add(`${path.basename(file)}.url`);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries.filter(
      (entry) => entry.isFile() && !keep.has(entry.name)
    );

    for (const file of files) {
      fs.rmSync(path.join(this.dir, file.name), { force: true });
    }

    // cap: keep at most MAX_CACHE_FILES of the remaining (kept) covers,
    // evicting the oldest by mtime
    const remaining = Array.from(keep)
      .map((name) => {
        const fullPath = path.join(this.dir, name);
        try {
          const mtime = fs.statSync(fullPath).mtimeMs;
          return { name, fullPath, mtime };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { name: string; fullPath: string; mtime: number } =>
          entry !== null && !entry.name.endsWith(".url")
      )
      .sort((a, b) => b.mtime - a.mtime);

    for (const entry of remaining.slice(MAX_CACHE_FILES)) {
      fs.rmSync(entry.fullPath, { force: true });
      fs.rmSync(`${entry.fullPath}.url`, { force: true });
    }
  }
}
