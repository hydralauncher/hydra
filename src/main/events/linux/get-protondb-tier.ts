import { ipcMain } from "electron";
import axios from "axios";
import { logger } from "@main/services/logger";

ipcMain.handle("getProtonDBTier", async (_, appId: number) => {
  try {
    const response = await axios.get(
      `https://www.protondb.com/api/v1/reports/summaries/${appId}.json`
    );
    return response.data.tier;
  } catch (error) {
    logger.error(`Failed to get ProtonDB tier for appId ${appId}`, error);
    return null;
  }
});
