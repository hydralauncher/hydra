import type { SouvenirSort } from "@types";

export const SOUVENIRS_PAGE_SIZE = 24;

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

export const getSouvenirKey = (gameId: string, name: string) =>
  `${encodeURIComponent(gameId)}:${encodeURIComponent(name)}`;

export const buildUserSouvenirLikePath = (
  ownerUserId: string,
  gameId: string,
  name: string
) =>
  `/users/${encodeURIComponent(ownerUserId)}/souvenirs/${encodeURIComponent(gameId)}/${encodeURIComponent(name)}/like`;

export const buildProfileSouvenirVisibilityPath = (
  gameId: string,
  name: string
) =>
  `/profile/games/achievements/${encodeURIComponent(gameId)}/${encodeURIComponent(name)}/image/visibility`;
