import { formatName } from "@shared";
import { downloadSourcesSublevel, localDownloadsSublevel } from "@main/level";
import { logger } from "./logger";
import type {
  DownloadSource,
  DownloadSourceDownload,
  GameRepack,
} from "@types";

interface LocalDownloadEntry {
  id: string;
  normalizedTitle: string;
  download: DownloadSourceDownload;
  sourceId: string;
  sourceName: string;
}

/**
 * Handles file-based (local) download sources entirely on the client.
 * The official flow indexes sources server-side; local sources are parsed,
 * stored and matched here so games can surface their download options
 * without the source being publicly reachable.
 */
export class LocalDownloadSources {
  private static index: LocalDownloadEntry[] = [];

  static async buildIndex(): Promise<void> {
    try {
      const sources = await downloadSourcesSublevel.values().all();
      const localSources = sources.filter((s) => s.isLocal);

      const entries: LocalDownloadEntry[] = [];
      for (const source of localSources) {
        const downloads = (await localDownloadsSublevel.get(source.id)) ?? [];
        downloads.forEach((download, i) => {
          entries.push({
            id: `local:${source.id}:${i}`,
            normalizedTitle: formatName(download.title ?? ""),
            download,
            sourceId: source.id,
            sourceName: source.name,
          });
        });
      }

      this.index = entries;
      logger.info(
        `LocalDownloadSources: indexed ${entries.length} downloads from ${localSources.length} local source(s)`
      );
    } catch (error) {
      logger.error("LocalDownloadSources: failed to build index", error);
      this.index = [];
    }
  }

  static async addSource(
    source: DownloadSource,
    downloads: DownloadSourceDownload[]
  ): Promise<void> {
    await localDownloadsSublevel.put(source.id, downloads);
    await downloadSourcesSublevel.put(source.id, source);
    await this.buildIndex();
  }

  static async removeSource(sourceId: string): Promise<void> {
    await localDownloadsSublevel.del(sourceId).catch(() => {});
    await this.buildIndex();
  }

  // A download matches a game when its normalized title equals the game name,
  // or starts with it at a word boundary. Guards against sequels / other games
  // whose title merely extends this one (e.g. "Portal" must not match "Portal 2").
  private static titleMatches(title: string, query: string): boolean {
    if (title === query) return true;
    if (!title.startsWith(`${query} `)) return false;
    return !/^\d/.test(title.slice(query.length + 1));
  }

  static getOptionsForGame(gameTitle: string): GameRepack[] {
    const query = formatName(gameTitle ?? "").trim();
    if (query.length < 3) return [];

    return this.index
      .filter((entry) => this.titleMatches(entry.normalizedTitle, query))
      .map((entry) => ({
        id: entry.id,
        title: entry.download.title,
        fileSize: entry.download.fileSize || null,
        uris: entry.download.uris ?? [],
        unavailableUris: [],
        uploadDate: entry.download.uploadDate || null,
        downloadSourceId: entry.sourceId,
        downloadSourceName: entry.sourceName,
        createdAt: entry.download.uploadDate || new Date(0).toISOString(),
      }));
  }
}
