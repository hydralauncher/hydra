import { Badge } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { db, levelKeys } from "@main/level";

const getBadges = async (_event: Electron.IpcMainInvokeEvent) => {
  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf-8",
    })
    .then((language) => language || "en");

  const params = new URLSearchParams({
    locale: language,
  });

  return HydraApi.get<Badge[]>(`/badges?${params.toString()}`, null, {
    needsAuth: false,
  });
};

registerEvent("getBadges", getBadges);
