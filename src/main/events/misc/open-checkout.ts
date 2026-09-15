import { shell } from "electron";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import type { Auth, OpenCheckoutOptions } from "@types";

const isAllowedPath = (path: string) =>
  path === "/" || path === "/gift" || /^\/gifts\/[A-Za-z0-9]{8}$/.test(path);

const isEncodedId = (value: string) => /^[A-Za-z0-9]{8}$/.test(value);

const openCheckout = async (
  _event: Electron.IpcMainInvokeEvent,
  options?: OpenCheckoutOptions
) => {
  const auth = await db.get<string, Auth>(levelKeys.auth, {
    valueEncoding: "json",
  });

  if (!auth) {
    return;
  }

  const paymentToken = await HydraApi.post("/auth/payment", {
    refreshToken: auth.refreshToken,
  }).then((response) => response.accessToken);

  const checkoutUrl = new URL(import.meta.env.MAIN_VITE_CHECKOUT_URL);

  if (options?.path && isAllowedPath(options.path)) {
    checkoutUrl.pathname = options.path;
  }

  if (options?.recipientId && isEncodedId(options.recipientId)) {
    checkoutUrl.searchParams.set("recipientId", options.recipientId);
  }

  checkoutUrl.searchParams.set("token", paymentToken);

  shell.openExternal(checkoutUrl.toString());
};

registerEvent("openCheckout", openCheckout);
