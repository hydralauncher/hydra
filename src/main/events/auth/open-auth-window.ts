import i18next from "i18next";
import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
import { AuthPage } from "@shared";

const openAuthWindow = async (
  _event: Electron.IpcMainInvokeEvent,
  page: AuthPage
) => {
  const searchParams = new URLSearchParams({
    lng: i18next.language,
  });

  if ([AuthPage.UpdateEmail, AuthPage.UpdatePassword].includes(page)) {
    const { accessToken } = await HydraApi.refreshToken();
    searchParams.set("token", accessToken);
  }

  WindowManager.openAuthWindow(page, searchParams);
};

registerEvent("openAuthWindow", openAuthWindow);
