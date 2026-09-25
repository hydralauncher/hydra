import type { SteamAppDetails } from "@types";

export interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data?: SteamAppDetails;
  };
}

export const parseSteamAppDetailsResponse = (
  response: SteamAppDetailsResponse,
  objectId: string
) => {
  const entry = Object.values(response).find(
    (item) => item?.success && String(item.data?.steam_appid) === objectId
  );

  return entry?.data ? { ...entry.data, objectId } : null;
};
