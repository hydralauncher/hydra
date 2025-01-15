import { shell } from "electron";
import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { ManageAccountPage } from "@types";

const openManageAccount = async (
  _event: Electron.IpcMainInvokeEvent,
  page: ManageAccountPage
) => {
  try {
    const { accessToken } = await HydraApi.refreshToken();

    const params = new URLSearchParams({
      token: accessToken,
    });

    shell.openExternal(
      `${import.meta.env.MAIN_VITE_AUTH_URL}/${page}?${params.toString()}`
    );
  } catch (err) {
    logger.error("Failed to open manage account", err);
  }
};

registerEvent("openManageAccount", openManageAccount);
