import {
  cancelSteamLogin,
  startSteamCredentialsLogin,
  startSteamQrLogin,
  submitSteamLoginGuardCode,
} from "@main/services/steam-integration/steam-client-login";
import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("openSteamConnectionWindow", () =>
  WindowManager.openSteamConnectionWindow(cancelSteamLogin)
);

registerEvent("minimizeSteamConnectionWindow", () =>
  WindowManager.minimizeSteamConnectionWindow()
);

registerEvent("closeSteamConnectionWindow", () =>
  WindowManager.closeSteamConnectionWindow()
);

registerEvent(
  "startSteamQrLogin",
  (_event: Electron.IpcMainInvokeEvent, lng: string) => startSteamQrLogin(lng)
);

registerEvent(
  "startSteamCredentialsLogin",
  (
    _event: Electron.IpcMainInvokeEvent,
    accountName: string,
    password: string,
    lng: string
  ) => startSteamCredentialsLogin(accountName, password, lng)
);

registerEvent(
  "submitSteamLoginGuardCode",
  (_event: Electron.IpcMainInvokeEvent, code: string) =>
    submitSteamLoginGuardCode(code)
);

registerEvent("cancelSteamLogin", () => cancelSteamLogin());
