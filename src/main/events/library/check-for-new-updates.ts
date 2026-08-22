import { registerEvent } from "../register-event";
import { DownloadSourcesChecker } from "@main/services/download-sources-checker";
import { logger } from "@main/services";

const checkForNewUpdates = async () => {
  try {
    await DownloadSourcesChecker.checkForChanges(true);
  } catch (err) {
    logger.error("Error in checkForNewUpdates", err);
  }
};

registerEvent("checkForNewUpdates", checkForNewUpdates);
