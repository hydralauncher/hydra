import axios from "axios";

export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url: string;
}

interface GetOwnedGamesResponse {
  response: {
    game_count: number;
    games: SteamOwnedGame[];
  };
}

export class SteamLibraryApi {
  static async getOwnedGames(
    steamId: string,
    apiKey: string
  ): Promise<SteamOwnedGame[]> {
    const { data } = await axios.get<GetOwnedGamesResponse>(
      "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
      {
        params: {
          key: apiKey,
          steamid: steamId,
          include_appinfo: true,
          include_played_free_games: true,
          format: "json",
        },
      }
    );

    return data.response?.games ?? [];
  }
}
