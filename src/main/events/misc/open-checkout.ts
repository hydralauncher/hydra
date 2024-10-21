import { shell } from "electron";
import { registerEvent } from "../register-event";
import { userAuthRepository } from "@main/repository";
import { HydraApi } from "@main/services";

const openCheckout = async (_event: Electron.IpcMainInvokeEvent) => {
  const userAuth = await userAuthRepository.findOne({ where: { id: 1 } });

  if (!userAuth) {
    return;
  }

  const paymentToken = await HydraApi.post("/auth/payment", {
    refreshToken: userAuth.refreshToken,
  }).then((response) => response.accessToken);

  shell.openExternal(
    "https://checkout.hydralauncher.gg/?token=" + paymentToken
  );
};

registerEvent("openCheckout", openCheckout);
