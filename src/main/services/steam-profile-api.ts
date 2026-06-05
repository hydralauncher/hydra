import axios from "axios";

export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  avatarfull: string;
}

interface GetPlayerSummariesResponse {
  response: {
    players: SteamPlayerSummary[];
  };
}

export class SteamProfileApi {
  static async getPlayerSummary(
    steamId: string,
    apiKey: string
  ): Promise<SteamPlayerSummary | null> {
    const { data } = await axios.get<GetPlayerSummariesResponse>(
      "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
      { params: { key: apiKey, steamids: steamId } }
    );

    return data.response?.players?.[0] ?? null;
  }
}
