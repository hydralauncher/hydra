import { shell } from "electron";
import { registerEvent } from "../register-event";
import {
  userAuthRepository,
  userPreferencesRepository,
} from "@main/repository";
import { HydraApi } from "@main/services";

const openCheckout = async (_event: Electron.IpcMainInvokeEvent) => {
  const [userAuth, userPreferences] = await Promise.all([
    userAuthRepository.findOne({ where: { id: 1 } }),
    userPreferencesRepository.findOne({ where: { id: 1 } }),
  ]);

  if (!userAuth) {
    return;
  }

  const paymentToken = await HydraApi.post("/auth/payment", {
    refreshToken: userAuth.refreshToken,
  }).then((response) => response.accessToken);

  const params = new URLSearchParams({
    token: paymentToken,
    lng: userPreferences?.language || "en",
  });

  shell.openExternal(
    `${import.meta.env.MAIN_VITE_CHECKOUT_URL}?${params.toString()}`
  );
};

registerEvent("openCheckout", openCheckout);
