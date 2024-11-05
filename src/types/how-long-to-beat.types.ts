export interface HowLongToBeatCategory {
  title: string;
  duration: string;
  accuracy: string;
}

export interface HowLongToBeatResult {
  game_id: number;
  game_name: string;
}

export interface HowLongToBeatSearchResponse {
  data: HowLongToBeatResult[];
}
