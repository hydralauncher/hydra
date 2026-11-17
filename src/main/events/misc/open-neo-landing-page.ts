import { shell } from "electron";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";
import { neoLandingPageUrl } from "@main/constants";
import { logger } from "@main/services/logger";
import type { Auth } from "@types";

const getNeoToken = async () => {
  const auth = await db.get<string, Auth>(levelKeys.auth, {
    valueEncoding: "json",
  });

  if (!auth) return null;

  return HydraApi.post<{ accessToken: string }>("/auth/neo", {
    refreshToken: auth.refreshToken,
  })
    .then((response) => response.accessToken)
    .catch((error) => {
      logger.error("Failed to get the Neo landing page token", error);
      return null;
    });
};

const openNeoLandingPage = async () => {
  const url = new URL(neoLandingPageUrl);
  const token = await getNeoToken();

  if (token) url.searchParams.set("token", token);

  await shell.openExternal(url.toString());
};

registerEvent("openNeoLandingPage", openNeoLandingPage);
