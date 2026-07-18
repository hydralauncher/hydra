import { registerEvent } from "../register-event";
import { DownloadSourcesChecker } from "@main/services/download-sources-checker";
import { logger } from "@main/services";

const checkForNewUpdates = async () => {
  try {
    // Pass true for isManualRefresh so it doesn't wipe existing badges
    await DownloadSourcesChecker.checkForChanges(true);
  } catch (err) {
    logger.error("Error in checkForNewUpdates", err);
  }
};

registerEvent("checkForNewUpdates", checkForNewUpdates);
