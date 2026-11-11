export type SaveSlotKind =
  | "manual"
  | "auto"
  | "quick"
  | "pointOfNoReturn"
  | "endGame"
  | "profile"
  | "unknown";

export type SaveStatKind =
  | "playtime"
  | "level"
  | "chapter"
  | "inGameDay"
  | "quest"
  | "questsCompleted"
  | "objective"
  | "location"
  | "completion"
  | "money"
  | "difficulty"
  | "newGamePlus"
  | "characterName"
  | "characterClass"
  | "reputation"
  | "collectibles"
  | "deaths"
  | "content"
  | "gameVersion"
  | "achievements"
  | "hearts";

export type SaveStatValue =
  | { type: "integer"; value: number }
  | { type: "text"; value: string }
  | { type: "seconds"; value: number }
  | { type: "percent"; value: number }
  | { type: "progress"; value: { current: number; total: number } }
  | { type: "list"; value: string[] }
  | { type: "label"; value: { key: string; text: string } };

export interface SaveStatName {
  key: string;
  text: string;
}

export interface SaveStat {
  kind: SaveStatKind;
  value: SaveStatValue;
  /** The game's own name for the stat ("Eddies" for money); translate `key`, fall back to `text`. */
  name?: SaveStatName;
}

export interface SaveSummaryThumbnail {
  file: string;
  mimeType: string;
  range?: { offset: number; length: number };
  width?: number;
  height?: number;
}

export interface SaveSummarySlot {
  id: string;
  kind: SaveSlotKind;
  title?: string;
  savedAtMs?: number;
  playthrough?: string;
  stats: SaveStat[];
  thumbnail?: SaveSummaryThumbnail;
  files: string[];
}

export interface SaveSummary {
  schemaVersion: number;
  parsers: string[];
  profile: SaveStat[];
  slots: SaveSummarySlot[];
}

export interface CloudSaveInsights {
  local: SaveSummary | null;
  remote: SaveSummary | null;
}
