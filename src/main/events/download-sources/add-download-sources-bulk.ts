import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";
import { logger } from "@main/services";

interface BulkAddResult {
  success: number;
  failed: number;
  errors: string[];
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes("already exists")) {
      return "Already exists";
    }
    return error.message;
  }
  return "Unknown error";
};

const addSingleDownloadSource = async (
  url: string,
  existingUrls: Set<string>,
  result: BulkAddResult
): Promise<boolean> => {
  if (existingUrls.has(url)) {
    result.failed++;
    result.errors.push(`"${url}" - Already exists`);
    return false;
  }

  try {
    const downloadSource = await HydraApi.post<DownloadSource>(
      "/download-sources",
      {
        url,
      },
      { needsAuth: false }
    );

    await downloadSourcesSublevel.put(downloadSource.id, {
      ...downloadSource,
      isRemote: true,
      createdAt: new Date().toISOString(),
    });

    result.success++;
    return true;
  } catch (error) {
    result.failed++;
    const errorMessage = getErrorMessage(error);
    result.errors.push(`"${url}" - ${errorMessage}`);
    logger.error(`Failed to add download source "${url}":`, error);
    return false;
  }
};

const addDownloadSourcesBulk = async (
  _event: Electron.IpcMainInvokeEvent,
  urls: string[]
): Promise<BulkAddResult> => {
  const result: BulkAddResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  const existingSources = await downloadSourcesSublevel.values().all();
  const existingUrls = new Set(existingSources.map((source) => source.url));

  const uniqueUrls = Array.from(new Set(urls));
  const profileUrls: string[] = [];

  for (const url of uniqueUrls) {
    const added = await addSingleDownloadSource(url, existingUrls, result);
    if (added && HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription()) {
      profileUrls.push(url);
    }
  }

  if (
    profileUrls.length > 0 &&
    HydraApi.isLoggedIn() &&
    HydraApi.hasActiveSubscription()
  ) {
    try {
      await HydraApi.post("/profile/download-sources", {
        urls: profileUrls,
      });
    } catch (error) {
      logger.error("Failed to add download sources to profile:", error);
    }
  }

  return result;
};

registerEvent("addDownloadSourcesBulk", addDownloadSourcesBulk);
