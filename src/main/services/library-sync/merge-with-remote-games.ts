import type { Game, ShopAssets } from "@types";
import { HydraApi } from "../hydra-api";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { reconcileRemoteArtworkSelection } from "./reconcile-remote-artwork-selection";
import type { CustomArtworkUrls } from "./reconcile-remote-artwork-selection";

type ProfileGame = {
  id: string;
  createdAt?: string | null;
  collectionIds?: string[];
  collectionId?: string | null;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  achievementCount: number;
  unlockedAchievementCount: number;
  platform?: string | null;
  customLibraryImageUrl?: string | null;
  customLibraryHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  customIconUrl?: string | null;
} & ShopAssets;

const reconcileCustomAsset = (
  localValue: string | null | undefined,
  remoteValue: string | null | undefined
): string | null | undefined => {
  if (remoteValue === undefined) return localValue;
  if (typeof localValue === "string" && localValue.startsWith("local:")) {
    return localValue;
  }
  return remoteValue;
};

const getRemoteCustomAssets = (game: ProfileGame): CustomArtworkUrls => ({
  customIconUrl: game.customIconUrl,
  customLogoImageUrl: game.customLogoImageUrl,
  customHeroImageUrl: game.customLibraryHeroImageUrl,
  customCoverImageUrl: game.customLibraryImageUrl,
});

const syncArtworkSelectionWithRemote = async (
  gameKey: string,
  localGame: Game | undefined,
  remoteGame: ProfileGame
) => {
  const selection = await gamesArtworkSelectionSublevel.get(gameKey);
  if (!selection) return;

  const { selected, changed } = reconcileRemoteArtworkSelection(
    selection.selected,
    localGame ?? {},
    getRemoteCustomAssets(remoteGame)
  );
  if (!changed) return;

  if (Object.keys(selected).length) {
    await gamesArtworkSelectionSublevel.put(gameKey, {
      ...selection,
      selected,
      updatedAt: Date.now(),
    });
  } else {
    await gamesArtworkSelectionSublevel.del(gameKey);
  }
};

interface CollectionSource {
  collectionIds?: string[];
  collectionId?: string | null;
}

const getCollectionIds = (source: CollectionSource | null | undefined) => {
  if (!source) return [];
  if (Array.isArray(source.collectionIds)) return source.collectionIds;
  if (source.collectionId) return [source.collectionId];
  return [];
};

const getLatestLastTimePlayed = (
  localGame: Game,
  remoteGame: ProfileGame
): Date | null => {
  if (localGame.lastTimePlayed == null) return remoteGame.lastTimePlayed;
  if (
    remoteGame.lastTimePlayed &&
    new Date(remoteGame.lastTimePlayed) > new Date(localGame.lastTimePlayed)
  ) {
    return remoteGame.lastTimePlayed;
  }

  return localGame.lastTimePlayed;
};

const getRemoteCoverImageUrl = (game: ProfileGame): string | null => {
  if (game.coverImageUrl) return game.coverImageUrl;
  if (game.shop !== "steam") return null;

  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`;
};

const PAGE_SIZE = 100;

const fetchAllGamesForShop = async (
  params: Record<string, unknown> = {}
): Promise<ProfileGame[]> => {
  const all: ProfileGame[] = [];
  let skip = 0;

  for (;;) {
    const page = await HydraApi.get<ProfileGame[]>("/profile/games", {
      ...params,
      take: PAGE_SIZE,
      skip,
    });

    all.push(...page);

    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
};

const fetchRemoteGames = async (): Promise<ProfileGame[]> => {
  const [defaultGames, classicsGames] = await Promise.all([
    fetchAllGamesForShop(),
    fetchAllGamesForShop({ shop: "launchbox" }).catch(
      () => [] as ProfileGame[]
    ),
  ]);

  return [...defaultGames, ...classicsGames];
};

const mergeExistingGame = (
  localGame: Game,
  remoteGame: ProfileGame,
  collectionIds: string[],
  remoteAddedToLibraryAt: Date | null
): Game => ({
  ...localGame,
  remoteId: remoteGame.id,
  addedToLibraryAt: localGame.addedToLibraryAt ?? remoteAddedToLibraryAt,
  lastTimePlayed: getLatestLastTimePlayed(localGame, remoteGame),
  playTimeInMilliseconds: Math.max(
    localGame.playTimeInMilliseconds,
    remoteGame.playTimeInMilliseconds
  ),
  favorite: remoteGame.isFavorite ?? localGame.favorite,
  isPinned: remoteGame.isPinned ?? localGame.isPinned,
  collectionIds,
  achievementCount: remoteGame.achievementCount,
  unlockedAchievementCount: remoteGame.unlockedAchievementCount,
  platform: remoteGame.platform ?? localGame.platform,
  customIconUrl: reconcileCustomAsset(
    localGame.customIconUrl,
    remoteGame.customIconUrl
  ),
  customLogoImageUrl: reconcileCustomAsset(
    localGame.customLogoImageUrl,
    remoteGame.customLogoImageUrl
  ),
  customHeroImageUrl: reconcileCustomAsset(
    localGame.customHeroImageUrl,
    remoteGame.customLibraryHeroImageUrl
  ),
  customCoverImageUrl: reconcileCustomAsset(
    localGame.customCoverImageUrl,
    remoteGame.customLibraryImageUrl
  ),
});

const createLocalGame = (
  remoteGame: ProfileGame,
  collectionIds: string[],
  addedToLibraryAt: Date | null
): Game => ({
  objectId: remoteGame.objectId,
  title: remoteGame.title,
  remoteId: remoteGame.id,
  shop: remoteGame.shop,
  iconUrl: remoteGame.iconUrl,
  libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
  logoImageUrl: remoteGame.logoImageUrl,
  addedToLibraryAt,
  lastTimePlayed: remoteGame.lastTimePlayed,
  playTimeInMilliseconds: remoteGame.playTimeInMilliseconds,
  hasManuallyUpdatedPlaytime: remoteGame.hasManuallyUpdatedPlaytime,
  isDeleted: false,
  favorite: remoteGame.isFavorite ?? false,
  isPinned: remoteGame.isPinned ?? false,
  collectionIds,
  achievementCount: remoteGame.achievementCount,
  unlockedAchievementCount: remoteGame.unlockedAchievementCount,
  platform: remoteGame.platform ?? null,
  customIconUrl: remoteGame.customIconUrl ?? null,
  customLogoImageUrl: remoteGame.customLogoImageUrl ?? null,
  customHeroImageUrl: remoteGame.customLibraryHeroImageUrl ?? null,
  customCoverImageUrl: remoteGame.customLibraryImageUrl ?? null,
});

const mergeRemoteGame = async (remoteGame: ProfileGame) => {
  const gameKey = levelKeys.game(remoteGame.shop, remoteGame.objectId);
  const localGame = await gamesSublevel.get(gameKey);
  const hasRemoteCollectionField =
    Array.isArray(remoteGame.collectionIds) ||
    Object.hasOwn(remoteGame, "collectionId");
  const collectionIds = hasRemoteCollectionField
    ? getCollectionIds(remoteGame)
    : getCollectionIds(localGame);
  const remoteAddedToLibraryAt = remoteGame.createdAt
    ? new Date(remoteGame.createdAt)
    : null;
  const mergedGame = localGame
    ? mergeExistingGame(
        localGame,
        remoteGame,
        collectionIds,
        remoteAddedToLibraryAt
      )
    : createLocalGame(remoteGame, collectionIds, remoteAddedToLibraryAt);

  await gamesSublevel.put(gameKey, mergedGame);
  await syncArtworkSelectionWithRemote(gameKey, localGame, remoteGame);

  const localGameShopAsset = await gamesShopAssetsSublevel.get(gameKey);
  await gamesShopAssetsSublevel.put(gameKey, {
    updatedAt: Date.now(),
    ...localGameShopAsset,
    shop: remoteGame.shop,
    objectId: remoteGame.objectId,
    title: localGame?.title || remoteGame.title,
    coverImageUrl: getRemoteCoverImageUrl(remoteGame),
    libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
    libraryImageUrl: remoteGame.libraryImageUrl,
    logoImageUrl: remoteGame.logoImageUrl,
    iconUrl: remoteGame.iconUrl,
    logoPosition: remoteGame.logoPosition,
    downloadSources: remoteGame.downloadSources,
  });
};

export const mergeWithRemoteGames = async () => {
  try {
    const remoteGames = await fetchRemoteGames();
    for (const game of remoteGames) {
      await mergeRemoteGame(game);
    }
  } catch {
    // Keep local library available when remote sync fails.
  }
};
