import type { PixelIconName } from "@renderer/components/gamification";
import type { Mission, TrailKey } from "@types";

const CATEGORY_ICONS: Record<string, PixelIconName> = {
  play: "pad",
  discovery: "eye",
  achievements: "cup",
  social: "users",
  content: "pen",
  library: "star",
  meta: "bolt",
};

const MISSION_ICONS: Record<string, PixelIconName> = {
  "daily.like_souvenirs": "heart",
  "daily.play_classic": "sand",
  "weekly.classic_two_consoles": "sand",
  "weekly.classic_3h": "sand",
  "weekly.play_four_days": "clock",
  "weekly.play_every_day": "clock",
  "weekly.platinum_game": "crown",
};

export const TRAIL_ICONS: Record<TrailKey, PixelIconName> = {
  playtime: "clock",
  achievements: "cup",
  souvenirs: "camera",
  friends: "users",
  reviews: "pen",
  likesReceived: "heart",
};

export const getMissionIcon = (mission: Mission): PixelIconName =>
  MISSION_ICONS[mission.key] ?? CATEGORY_ICONS[mission.category] ?? "star";

const toMissionTextKey = (missionKey: string, field: string) =>
  `mission_${missionKey.replace(/\./g, "_")}_${field}`;

export const getMissionTitleKey = (mission: Mission) =>
  toMissionTextKey(mission.key, "title");

export const getMissionDescriptionKey = (mission: Mission) =>
  toMissionTextKey(mission.key, "description");
