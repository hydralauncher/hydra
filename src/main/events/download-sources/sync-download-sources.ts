import { registerEvent } from "../register-event";
import axios, { AxiosError } from "axios";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";
import {
  invalidateIdCaches,
  downloadSourceSchema,
  getSteamGames,
  addNewDownloads,
} from "./helpers";

const syncDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<number> => {
  let newRepacksCount = 0;

  try {
    const downloadSources: Array<{
      id: number;
      url: string;
      name: string;
      etag: string | null;
      status: number;
      downloadCount: number;
      objectIds: string[];
      fingerprint?: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    for await (const [, source] of downloadSourcesSublevel.iterator()) {
      downloadSources.push(source);
    }

    const existingRepacks: Array<{
      id: number;
      title: string;
      uris: string[];
      repacker: string;
      fileSize: string | null;
      objectIds: string[];
      uploadDate: Date | string | null;
      downloadSourceId: number;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    for await (const [, repack] of repacksSublevel.iterator()) {
      existingRepacks.push(repack);
    }

    // Handle sources with missing fingerprints individually, don't delete all sources
    const sourcesWithFingerprints = downloadSources.filter(
      (source) => source.fingerprint
    );
    const sourcesWithoutFingerprints = downloadSources.filter(
      (source) => !source.fingerprint
    );

    // For sources without fingerprints, just continue with normal sync
    // They will get fingerprints updated later by updateMissingFingerprints
    const allSourcesToSync = [
      ...sourcesWithFingerprints,
      ...sourcesWithoutFingerprints,
    ];

    for (const downloadSource of allSourcesToSync) {
      const headers: Record<string, string> = {};

      if (downloadSource.etag) {
        headers["If-None-Match"] = downloadSource.etag;
      }

      try {
        const response = await axios.get(downloadSource.url, {
          headers,
        });

        const source = await downloadSourceSchema.validate(response.data);
        const steamGames = await getSteamGames();

        const repacks = source.downloads.filter(
          (download) =>
            !existingRepacks.some((repack) => repack.title === download.title)
        );

        await downloadSourcesSublevel.put(`${downloadSource.id}`, {
          ...downloadSource,
          etag: response.headers["etag"] || null,
          downloadCount: source.downloads.length,
          status: DownloadSourceStatus.UpToDate,
        });

        await addNewDownloads(downloadSource, repacks, steamGames);

        newRepacksCount += repacks.length;
      } catch (err: unknown) {
        const isNotModified = (err as AxiosError).response?.status === 304;

        await downloadSourcesSublevel.put(`${downloadSource.id}`, {
          ...downloadSource,
          status: isNotModified
            ? DownloadSourceStatus.UpToDate
            : DownloadSourceStatus.Errored,
        });
      }
    }

    invalidateIdCaches();

    return newRepacksCount;
  } catch (err) {
    return -1;
  }
};

registerEvent("syncDownloadSources", syncDownloadSources);
