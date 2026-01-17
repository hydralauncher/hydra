import { shell } from "electron";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import type { Auth } from "@types";

const openCheckout = async (_event: Electron.IpcMainInvokeEvent) => {
  const auth = await db.get<string, Auth>(levelKeys.auth, {
    valueEncoding: "json",
  });

  if (!auth) {
    return;
  }

  const paymentToken = await HydraApi.post("/auth/payment", {
    refreshToken: auth.refreshToken,
  }).then((response) => response.accessToken);

  const params = new URLSearchParams({
    token: paymentToken,
  });

  shell.openExternal(
    `${import.meta.env.MAIN_VITE_CHECKOUT_URL}?${params.toString()}`
  );
};

registerEvent("openCheckout", openCheckout);
