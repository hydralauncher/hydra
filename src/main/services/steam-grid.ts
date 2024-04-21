import { getSteamAppAsset } from "@main/helpers";

export interface SteamGridResponse {
  success: boolean;
  data: {
    id: number;
  };
}

export interface SteamGridGameResponse {
  data: {
    platforms: {
      steam: {
        metadata: {
          clienticon: string;
        };
      };
    };
  };
}

export const getSteamGridData = async (
  objectID: string,
  path: string,
  shop: string,
  params: Record<string, string> = {}
): Promise<SteamGridResponse> => {
  const searchParams = new URLSearchParams(params);

  const response = await fetch(
    `https://www.steamgriddb.com/api/v2/${path}/${shop}/${objectID}?${searchParams.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${import.meta.env.MAIN_VITE_STEAMGRIDDB_API_KEY}`,
      },
    }
  );

  return response.json();
};

export const getSteamGridGameById = async (
  id: number
): Promise<SteamGridGameResponse> => {
  const response = await fetch(
    `https://www.steamgriddb.com/api/public/game/${id}`,
    {
      method: "GET",
      headers: {
        Referer: "https://www.steamgriddb.com/",
      },
    }
  );

  return response.json();
};

export const getSteamGameIconUrl = async (objectID: string) => {
  const {
    data: { id: steamGridGameId },
  } = await getSteamGridData(objectID, "games", "steam");

  const steamGridGame = await getSteamGridGameById(steamGridGameId);

  return getSteamAppAsset(
    "icon",
    objectID,
    steamGridGame.data.platforms.steam.metadata.clienticon
  );
};
