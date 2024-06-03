import { downloadSourceSchema } from "@main/events/helpers/validators";
import { DownloadSourceStatus } from "@shared";
import type { DownloadSource } from "@types";
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
        status: isNotModified
          ? DownloadSourceStatus.UpToDate
          : DownloadSourceStatus.Errored,
      });
    }
  }

  return results;
};
