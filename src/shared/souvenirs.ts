import type {
  ProfileAchievement,
  ProfileSouvenir,
  ProfileSouvenirAchievement,
  SouvenirReportValues,
  SouvenirSort,
} from "@types";
import { SteamContentDescriptor } from "./constants.js";

export const SOUVENIRS_PAGE_SIZE = 24;

export const isAchievementSouvenirsEnabled = (
  preference: boolean | undefined,
  platform: string
) => preference ?? platform !== "linux";

export type SouvenirVisualVariant = "rare" | "platinum";

interface SouvenirRarity {
  isRare: boolean | null;
  isPlatinum: boolean;
}

export const getSouvenirVisualVariant = ({
  isRare,
  isPlatinum,
}: SouvenirRarity): SouvenirVisualVariant | null => {
  if (isPlatinum) return "platinum";
  if (isRare) return "rare";
  return null;
};

export const shouldShowSouvenirContentWarning = (
  souvenir: Pick<ProfileSouvenir, "gameContentDescriptorIds">,
  disableNsfwAlert: boolean
) =>
  !disableNsfwAlert &&
  souvenir.gameContentDescriptorIds?.includes(
    SteamContentDescriptor.AdultOnlySexualContent
  ) === true;

interface UserSouvenirsPathOptions {
  userId: string;
  skip?: number;
  take?: number;
  sortBy?: SouvenirSort;
  language?: string;
  shops?: Array<"steam" | "launchbox">;
}

export const buildUserSouvenirsPath = ({
  userId,
  skip = 0,
  take = SOUVENIRS_PAGE_SIZE,
  sortBy = "recent",
  language,
  shops = ["steam", "launchbox"],
}: UserSouvenirsPathOptions) => {
  const params = new URLSearchParams({
    take: String(take),
    skip: String(skip),
    sortBy,
  });

  for (const shop of shops) params.append("shop", shop);
  if (language) params.set("language", language);

  return `/users/${encodeURIComponent(userId)}/souvenirs?${params.toString()}`;
};

const getLegacySouvenirId = (gameId: string, name: string) =>
  `legacy:${encodeURIComponent(gameId)}:${encodeURIComponent(name)}`;

export const getSouvenirKey = (souvenirId: string) => souvenirId;

const toLegacyAchievement = (
  souvenir: ProfileAchievement
): ProfileSouvenirAchievement => ({
  name: souvenir.name,
  displayName: souvenir.displayName,
  description: souvenir.description,
  achievementIcon: souvenir.achievementIcon,
  unlockTime: souvenir.unlockTime,
  points: souvenir.points,
  isRare: souvenir.isRare,
  isPlatinum: souvenir.isPlatinum,
});

export const normalizeProfileSouvenir = (
  souvenir: ProfileSouvenir | ProfileAchievement
): ProfileSouvenir => {
  if ("id" in souvenir) {
    return souvenir;
  }

  return {
    ...souvenir,
    id: getLegacySouvenirId(souvenir.gameId, souvenir.name),
    capturedAt: souvenir.unlockTime,
    primaryAchievementName: souvenir.name,
    achievements: [toLegacyAchievement(souvenir)],
  };
};

export const getPrimarySouvenirAchievement = (
  souvenir: ProfileSouvenir
): ProfileSouvenirAchievement =>
  souvenir.achievements.find(
    (achievement) =>
      achievement.name.toUpperCase() ===
      souvenir.primaryAchievementName.toUpperCase()
  ) ??
  souvenir.achievements[0] ?? {
    name: souvenir.primaryAchievementName,
    displayName: souvenir.primaryAchievementName,
    description: "",
    achievementIcon: null,
    unlockTime: souvenir.capturedAt,
    points: null,
    isRare: null,
    isPlatinum: false,
  };

export const buildUserSouvenirLikePath = (
  ownerUserId: string,
  souvenirId: string
) =>
  `/users/${encodeURIComponent(ownerUserId)}/souvenirs/${encodeURIComponent(souvenirId)}/like`;

export const buildUserSouvenirReportPath = (
  ownerUserId: string,
  souvenirId: string
) =>
  `/users/${encodeURIComponent(ownerUserId)}/souvenirs/${encodeURIComponent(souvenirId)}/report`;

export const normalizeSouvenirReportValues = ({
  reason,
  description,
}: SouvenirReportValues): SouvenirReportValues => {
  const trimmedDescription = description?.trim();

  return {
    reason,
    ...(trimmedDescription ? { description: trimmedDescription } : {}),
  };
};

export const buildProfileSouvenirVisibilityPath = (souvenirId: string) =>
  `/profile/souvenirs/${encodeURIComponent(souvenirId)}/visibility`;

export const buildProfileSouvenirDeletePath = (souvenirId: string) =>
  `/profile/souvenirs/${encodeURIComponent(souvenirId)}`;

export const buildSouvenirNotificationTarget = (
  profileTarget: string,
  variables: Record<string, string>
) => {
  const souvenirTarget = variables.souvenirId ?? variables.souvenirKey;
  if (!souvenirTarget) return profileTarget;

  const [pathname, query = ""] = profileTarget.split("?");
  const params = new URLSearchParams(query);
  params.set("tab", "souvenirs");
  params.set("souvenir", souvenirTarget);
  return `${pathname}?${params.toString()}`;
};

export const findSouvenirByNotificationTarget = (
  souvenirs: ProfileSouvenir[],
  target: string
) => {
  const normalizedTarget = target.toLowerCase();

  return souvenirs.find((souvenir) => {
    const legacyKey = `${souvenir.gameId}:${souvenir.primaryAchievementName}`;
    return (
      souvenir.id.toLowerCase() === normalizedTarget ||
      legacyKey.toLowerCase() === normalizedTarget
    );
  });
};
