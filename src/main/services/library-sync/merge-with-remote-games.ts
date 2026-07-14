import { ShopAssets } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";

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
} & ShopAssets;

const getLocalCollectionIds = (
  localGame:
    | {
        collectionIds?: string[];
      }
    | {
        collectionId?: string | null;
      }
    | null
    | undefined
): string[] => {
  if (!localGame) return [];

  if (
    Array.isArray((localGame as { collectionIds?: string[] }).collectionIds)
  ) {
    return (localGame as { collectionIds: string[] }).collectionIds;
  }

  const legacyCollectionId = (localGame as { collectionId?: string | null })
    .collectionId;

  return legacyCollectionId ? [legacyCollectionId] : [];
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

export const mergeWithRemoteGames = async () => {
  const fetchGames = Promise.all([
    fetchAllGamesForShop(),
    fetchAllGamesForShop({ shop: "launchbox" }).catch(
      () => [] as ProfileGame[]
    ),
  ]).then(([defaultGames, classicsGames]) => [
    ...defaultGames,
    ...classicsGames,
  ]);

  return fetchGames
    .then(async (response) => {
      for (const game of response) {
        const gameKey = levelKeys.game(game.shop, game.objectId);
        const localGame = await gamesSublevel.get(gameKey);

        const localCollectionIds = getLocalCollectionIds(localGame);

        const hasRemoteCollectionField =
          Array.isArray(game.collectionIds) ||
          Object.prototype.hasOwnProperty.call(game, "collectionId");

        const remoteCollectionIds = Array.isArray(game.collectionIds)
          ? game.collectionIds
          : game.collectionId
            ? [game.collectionId]
            : [];

        const mergedCollectionIds = hasRemoteCollectionField
          ? remoteCollectionIds
          : localCollectionIds;
        const remoteAddedToLibraryAt = game.createdAt
          ? new Date(game.createdAt)
          : null;

        if (localGame) {
          const updatedLastTimePlayed =
            localGame.lastTimePlayed == null ||
            (game.lastTimePlayed &&
              new Date(game.lastTimePlayed) >
                new Date(localGame.lastTimePlayed))
              ? game.lastTimePlayed
              : localGame.lastTimePlayed;

          const updatedPlayTime =
            localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
              ? game.playTimeInMilliseconds
              : localGame.playTimeInMilliseconds;

          await gamesSublevel.put(gameKey, {
            ...localGame,
            remoteId: game.id,
            addedToLibraryAt:
              localGame.addedToLibraryAt ?? remoteAddedToLibraryAt,
            lastTimePlayed: updatedLastTimePlayed,
            playTimeInMilliseconds: updatedPlayTime,
            favorite: game.isFavorite ?? localGame.favorite,
            isPinned: game.isPinned ?? localGame.isPinned,
            collectionIds: mergedCollectionIds,
            achievementCount: game.achievementCount,
            unlockedAchievementCount: game.unlockedAchievementCount,
            platform: game.platform ?? localGame.platform,
          });
        } else {
          await gamesSublevel.put(gameKey, {
            objectId: game.objectId,
            title: game.title,
            remoteId: game.id,
            shop: game.shop,
            iconUrl: game.iconUrl,
            libraryHeroImageUrl: game.libraryHeroImageUrl,
            logoImageUrl: game.logoImageUrl,
            addedToLibraryAt: remoteAddedToLibraryAt,
            lastTimePlayed: game.lastTimePlayed,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            hasManuallyUpdatedPlaytime: game.hasManuallyUpdatedPlaytime,
            isDeleted: false,
            favorite: game.isFavorite ?? false,
            isPinned: game.isPinned ?? false,
            collectionIds: mergedCollectionIds,
            achievementCount: game.achievementCount,
            unlockedAchievementCount: game.unlockedAchievementCount,
            platform: game.platform ?? null,
          });
        }

        const localGameShopAsset = await gamesShopAssetsSublevel.get(gameKey);

        // Construct coverImageUrl if not provided by backend (Steam games use predictable pattern)
        const coverImageUrl =
          game.coverImageUrl ||
          (game.shop === "steam"
            ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`
            : null);

        await gamesShopAssetsSublevel.put(gameKey, {
          updatedAt: Date.now(),
          ...localGameShopAsset,
          shop: game.shop,
          objectId: game.objectId,
          title: localGame?.title || game.title, // Preserve local title if it exists
          coverImageUrl,
          libraryHeroImageUrl: game.libraryHeroImageUrl,
          libraryImageUrl: game.libraryImageUrl,
          logoImageUrl: game.logoImageUrl,
          iconUrl: game.iconUrl,
          logoPosition: game.logoPosition,
          downloadSources: game.downloadSources,
        });
      }
    })
    .catch(() => {});
};
