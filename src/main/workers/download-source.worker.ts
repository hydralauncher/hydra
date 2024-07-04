import { Repack } from "@main/entity";
import { downloadSourceSchema } from "@main/events/helpers/validators";
import { DownloadSourceStatus } from "@shared";
import type { DownloadSource, GameRepack } from "@types";
import axios, { AxiosError, AxiosHeaders } from "axios";
import { z } from "zod";

export type DownloadSourceResponse = z.infer<typeof downloadSourceSchema> & {
  etag: string | null;
  status: DownloadSourceStatus;
};

export const getUpdatedRepacks = async (downloadSources: DownloadSource[]) => {
  const results: DownloadSourceResponse[] = [];

  for (const downloadSource of downloadSources) {
    const headers = new AxiosHeaders();

    if (downloadSource.etag) {
      headers.set("If-None-Match", downloadSource.etag);
    }

    try {
      const response = await axios.get(downloadSource.url, {
        headers,
      });

      const source = downloadSourceSchema.parse(response.data);

      results.push({
        ...downloadSource,
        downloads: source.downloads,
        etag: response.headers["etag"],
        status: DownloadSourceStatus.UpToDate,
      });
    } catch (err: unknown) {
      const isNotModified = (err as AxiosError).response?.status === 304;

      results.push({
        ...downloadSource,
        downloads: [],
        etag: null,
        status: isNotModified
          ? DownloadSourceStatus.UpToDate
          : DownloadSourceStatus.Errored,
      });
    }
  }

  return results;
};

export const validateDownloadSource = async ({
  url,
  repacks,
}: {
  url: string;
  repacks: GameRepack[];
}) => {
  const response = await axios.get(url);

  const source = downloadSourceSchema.parse(response.data);

  const existingUris = source.downloads
    .flatMap((download) => download.uris)
    .filter((uri) => repacks.some((repack) => repack.magnet === uri));

  return {
    name: source.name,
    downloadCount: source.downloads.length - existingUris.length,
  };
};
