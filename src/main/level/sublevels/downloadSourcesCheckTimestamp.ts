import { levelKeys } from "./keys";
import { db } from "../level";

export const getLastDownloadSourcesCheck = async (): Promise<string | null> => {
  try {
    const timestamp = await db.get(levelKeys.lastDownloadSourcesCheck);
    return timestamp;
  } catch (error) {
    // Key doesn't exist yet
    return null;
  }
};

export const updateLastDownloadSourcesCheck = async (
  timestamp: string
): Promise<void> => {
  await db.put(levelKeys.lastDownloadSourcesCheck, timestamp);
};
