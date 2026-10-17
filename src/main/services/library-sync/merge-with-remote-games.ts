import {
  libraryWriteQueue,
  hasPendingHydraClaim,
  getEpicLibraryConnectionRevision,
  getHydraPlaytimeRevision,
} from "./library-write-queue";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import type { EpicConnection } from "../../../types/epic-integration.types";
import type {
  ArtworkAssetType,
  Game,
  LibraryCatalogueMetadata,
  GameArtworkSelection,
  SelectedArtwork,
  ShopAssets,
} from "@types";
import { chunk } from "lodash-es";
import { HydraApi, type HydraApiOptions } from "../hydra-api";
import { saveSteamGridDbArtwork } from "../game-artwork-cloud";
import {
  db,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
  markArtworkSelectionSynced,
} from "@main/level";
import {
  CUSTOM_ASSET_FIELD_BY_TYPE,
  reconcileRemoteArtworkSelection,
} from "./reconcile-remote-artwork-selection";
import type { CustomArtworkUrls } from "./reconcile-remote-artwork-selection";
import {
  mergeImportedProfileGame,
  type ImportedProfileGame,
} from "./merge-imported-profile-game";
import {
  resolveLibraryIsDeleted,
  resolveMissingSteamImport,
  resolveLibrarySource,
} from "./resolve-library-source";
import {
  mergeLocalAndRemotePlayTime,
  mergeLibraryCatalogueMetadata,
  preserveEpicDefaultArtwork,
} from "@shared";
import { mergePersistedAchievementTotals } from "../achievements/achievement-memory-store";
import { trackAchievementBatchGame } from "../achievements/achievement-batch-games";
import { fetchRemoteProfileGames as fetchProfileGames } from "./fetch-remote-profile-games";

type ProfileGame = {
  id: string;
  createdAt?: string | null;
  collectionIds?: string[];
  collectionId?: string | null;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
  playTimeInSeconds?: number;
  runtimeByPlatform?: { hydra?: number; epic?: number; steam?: number } | null;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite?: boolean;
  isHiddenFromOthers?: boolean;
  isConcealed?: boolean;
  isPinned?: boolean;
  achievementCount: number;
  unlockedAchievementCount: number;
  platform?: string | null;
  source?: string | null;
  hasActiveSteamImport?: boolean;
  hasActiveEpicImport?: boolean;
  customLibraryImageUrl?: string | null;
  customLibraryHeroImageUrl?: string | null;
  customLogoImageUrl?: string | null;
  customIconUrl?: string | null;
} & ShopAssets &
  LibraryCatalogueMetadata;

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

const uploadUnsyncedArtworkSelection = async (
  gameKey: string,
  selection: GameArtworkSelection,
  localGame: Game | undefined,
  remoteAssets: CustomArtworkUrls
) => {
  const entries = Object.entries(selection.selected) as Array<
    [ArtworkAssetType, SelectedArtwork]
  >;

  for (const [type, selected] of entries) {
    if (selected.syncedAt) continue;

    const field = CUSTOM_ASSET_FIELD_BY_TYPE[type];
    if (localGame?.[field]?.startsWith("local:")) continue;
    if (remoteAssets[field] === selected.url) continue;

    const synced = await saveSteamGridDbArtwork(
      selection.shop,
      selection.objectId,
      type,
      selected.url
    );

    if (synced) {
      await markArtworkSelectionSynced(gameKey, type, selected.url);
    }
  }
};

const syncArtworkSelectionWithRemote = async (
  gameKey: string,
  selection: GameArtworkSelection,
  localGame: Game | undefined,
  remoteGame: ProfileGame
) => {
  const remoteAssets = getRemoteCustomAssets(remoteGame);
  const { selected, changed } = reconcileRemoteArtworkSelection(
    selection.selected,
    localGame ?? {},
    remoteAssets
  );

  let current = selection;

  if (changed) {
    if (!Object.keys(selected).length) {
      await gamesArtworkSelectionSublevel.del(gameKey);
      return;
    }

    current = { ...selection, selected, updatedAt: Date.now() };
    await gamesArtworkSelectionSublevel.put(gameKey, current);
  }

  await uploadUnsyncedArtworkSelection(
    gameKey,
    current,
    localGame,
    remoteAssets
  );
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
  const identity = game.catalogueGame ?? game;
  if (identity.shop !== "steam") return null;

  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${identity.objectId}/library_600x900_2x.jpg`;
};

const MERGE_WRITE_CHUNK_SIZE = 250;
const TARGETED_MERGE_CONCURRENCY = 10;

export type RemoteGamesMergeProgress = (
  processed: number,
  total: number
) => void;

const fetchRemoteGames = (
  context?: HydraApiAuthContext | null,
  networkOptions: Pick<HydraApiOptions, "signal" | "timeout"> = {}
): Promise<ProfileGame[]> =>
  fetchProfileGames((path, params) =>
    HydraApi.get<ProfileGame[]>(path, params, {
      ...networkOptions,
      logResponseBody: false,
      ...(context ? { authContext: context } : {}),
    })
  );

export const fetchRemoteProfileGames = fetchRemoteGames;

const mergeExistingGame = (
  localGame: Game,
  remoteGame: ProfileGame,
  collectionIds: string[],
  remoteAddedToLibraryAt: Date | null,
  canReconcileCustomArtwork: boolean
): Game => ({
  ...localGame,
  ...mergeLibraryCatalogueMetadata(localGame, remoteGame),
  ...(remoteGame.catalogueGame && {
    title: remoteGame.title,
    iconUrl: remoteGame.iconUrl,
    libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
    logoImageUrl: remoteGame.logoImageUrl,
  }),
  remoteId:
    localGame.source === "hydra" &&
    localGame.remoteId === null &&
    remoteGame.source === "epic"
      ? null
      : remoteGame.id,
  addedToLibraryAt: localGame.addedToLibraryAt ?? remoteAddedToLibraryAt,
  lastTimePlayed: getLatestLastTimePlayed(localGame, remoteGame),
  ...mergeLocalAndRemotePlayTime(localGame, remoteGame),
  favorite: remoteGame.isFavorite ?? localGame.favorite,
  isHiddenFromOthers:
    remoteGame.isHiddenFromOthers ?? localGame.isHiddenFromOthers,
  isConcealed: remoteGame.isConcealed ?? localGame.isConcealed ?? false,
  isPinned: remoteGame.isPinned ?? localGame.isPinned,
  collectionIds,
  ...mergePersistedAchievementTotals(
    remoteGame.shop,
    remoteGame.objectId,
    localGame,
    remoteGame
  ),
  platform: remoteGame.platform ?? localGame.platform,
  source: resolveLibrarySource(localGame.source, remoteGame.source),
  hasActiveSteamImport: remoteGame.hasActiveSteamImport === true,
  hasActiveEpicImport:
    remoteGame.hasActiveEpicImport ?? localGame.hasActiveEpicImport ?? false,
  isDeleted: resolveLibraryIsDeleted(
    localGame.isDeleted,
    remoteGame.source,
    remoteGame.hasActiveSteamImport === true,
    remoteGame.hasActiveEpicImport === true
  ),
  ...(canReconcileCustomArtwork
    ? {
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
      }
    : {}),
});

const createLocalGame = (
  remoteGame: ProfileGame,
  collectionIds: string[],
  addedToLibraryAt: Date | null
): Game => ({
  ...mergeLibraryCatalogueMetadata(undefined, remoteGame),
  objectId: remoteGame.objectId,
  title: remoteGame.title,
  remoteId: remoteGame.id,
  shop: remoteGame.shop,
  iconUrl: remoteGame.iconUrl,
  libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
  logoImageUrl: remoteGame.logoImageUrl,
  addedToLibraryAt,
  lastTimePlayed: remoteGame.lastTimePlayed,
  ...mergeLocalAndRemotePlayTime({ playTimeInMilliseconds: 0 }, remoteGame),
  hasManuallyUpdatedPlaytime: remoteGame.hasManuallyUpdatedPlaytime,
  isDeleted: false,
  favorite: remoteGame.isFavorite ?? false,
  isHiddenFromOthers: remoteGame.isHiddenFromOthers ?? false,
  isConcealed: remoteGame.isConcealed ?? false,
  isPinned: remoteGame.isPinned ?? false,
  collectionIds,
  ...mergePersistedAchievementTotals(
    remoteGame.shop,
    remoteGame.objectId,
    {},
    remoteGame
  ),
  platform: remoteGame.platform ?? null,
  source: resolveLibrarySource(undefined, remoteGame.source),
  hasActiveSteamImport: remoteGame.hasActiveSteamImport === true,
  hasActiveEpicImport: remoteGame.hasActiveEpicImport === true,
  customIconUrl: remoteGame.customIconUrl ?? null,
  customLogoImageUrl: remoteGame.customLogoImageUrl ?? null,
  customHeroImageUrl: remoteGame.customLibraryHeroImageUrl ?? null,
  customCoverImageUrl: remoteGame.customLibraryImageUrl ?? null,
});

const buildRemoteGameShopAssets = (
  remoteGame: ProfileGame,
  localGame: Game | undefined,
  localShopAssets: ShopAssets | undefined
) => {
  const assets = {
    updatedAt: Date.now(),
    ...localShopAssets,
    shop: remoteGame.shop,
    objectId: remoteGame.objectId,
    title: remoteGame.catalogueGame
      ? remoteGame.title
      : localGame?.title || remoteGame.title,
    coverImageUrl: getRemoteCoverImageUrl(remoteGame),
    libraryHeroImageUrl: remoteGame.libraryHeroImageUrl,
    libraryImageUrl: remoteGame.libraryImageUrl,
    logoImageUrl: remoteGame.logoImageUrl,
    iconUrl: remoteGame.iconUrl,
    logoPosition: remoteGame.logoPosition,
    downloadSources: remoteGame.downloadSources,
  };
  return (remoteGame.catalogueGame ?? localGame?.catalogueGame)?.shop ===
    "steam"
    ? assets
    : preserveEpicDefaultArtwork(assets, localShopAssets);
};

const buildMergedGame = (
  remoteGame: ProfileGame,
  localGame: Game | undefined,
  canReconcileCustomArtwork: boolean
): Game => {
  const hasRemoteCollectionField =
    Array.isArray(remoteGame.collectionIds) ||
    Object.hasOwn(remoteGame, "collectionId");
  const collectionIds = hasRemoteCollectionField
    ? getCollectionIds(remoteGame)
    : getCollectionIds(localGame);
  const remoteAddedToLibraryAt = remoteGame.createdAt
    ? new Date(remoteGame.createdAt)
    : null;

  return localGame
    ? mergeExistingGame(
        localGame,
        remoteGame,
        collectionIds,
        remoteAddedToLibraryAt,
        canReconcileCustomArtwork
      )
    : createLocalGame(remoteGame, collectionIds, remoteAddedToLibraryAt);
};

const mergeRemoteGamesChunk = async (
  remoteGames: ProfileGame[],
  canReconcileCustomArtwork: boolean,
  context: HydraApiAuthContext | null,
  epicConnectionId: string | undefined,
  hydraRevision: number,
  current: () => boolean
) => {
  const { gameKeys, localGames, artworkSelections } =
    await libraryWriteQueue.run(async () => {
      const gameKeys = remoteGames.map((game) =>
        levelKeys.game(game.shop, game.objectId)
      );
      const [localGames, localShopAssets, artworkSelections] =
        await Promise.all([
          gamesSublevel.getMany(gameKeys),
          gamesShopAssetsSublevel.getMany(gameKeys),
          canReconcileCustomArtwork
            ? gamesArtworkSelectionSublevel.getMany(gameKeys)
            : Promise.resolve([]),
        ]);

      const batch = db.batch();

      remoteGames.forEach((remoteGame, index) => {
        const gameKey = gameKeys[index];
        const localGame = localGames[index];

        if (!localGame || localGame.isDeleted)
          trackAchievementBatchGame(gameKey);

        const merged = buildMergedGame(
          remoteGame,
          localGame,
          canReconcileCustomArtwork
        );
        if (localGame && getHydraPlaytimeRevision(gameKey) > hydraRevision) {
          merged.playTimeInMilliseconds = localGame.playTimeInMilliseconds;
          merged.hasManuallyUpdatedPlaytime =
            localGame.hasManuallyUpdatedPlaytime;
          merged.lastTimePlayed = localGame.lastTimePlayed;
        }
        if (remoteGame.hasActiveEpicImport && context && epicConnectionId)
          merged.epicImportScope = {
            environment: context.environment,
            userId: context.userId,
            connectionId: epicConnectionId,
          };
        else if (remoteGame.hasActiveEpicImport === false)
          merged.epicImportScope = undefined;
        batch.put(gameKey, merged, { sublevel: gamesSublevel });
        const assets = buildRemoteGameShopAssets(
          remoteGame,
          localGame,
          localShopAssets[index]
        );
        batch.put(gameKey, assets, { sublevel: gamesShopAssetsSublevel });
        if (remoteGame.catalogueGame) {
          const catalogueKey = levelKeys.game(
            remoteGame.catalogueGame.shop,
            remoteGame.catalogueGame.objectId
          );
          if (catalogueKey !== gameKey) {
            batch.put(
              catalogueKey,
              {
                ...remoteGame.catalogueGame,
                updatedAt: assets.updatedAt,
                title: assets.title,
                iconUrl: assets.iconUrl,
                libraryHeroImageUrl: assets.libraryHeroImageUrl,
                libraryImageUrl: assets.libraryImageUrl,
                coverImageUrl: assets.coverImageUrl,
                logoImageUrl: assets.logoImageUrl,
                logoPosition: assets.logoPosition,
                downloadSources: assets.downloadSources,
              },
              { sublevel: gamesShopAssetsSublevel }
            );
          }
        }
      });

      if (!current()) throw new Error("library-context-changed");
      await batch.write();
      return { gameKeys, localGames, artworkSelections };
    }, current);

  for (const [index, selection] of artworkSelections.entries()) {
    if (!selection) continue;

    await syncArtworkSelectionWithRemote(
      gameKeys[index],
      selection,
      localGames[index],
      remoteGames[index]
    );
  }
};

const hideGamesRemovedFromSteamImport = async (remoteKeys: Set<string>) => {
  const updates = (await gamesSublevel.iterator().all()).flatMap(
    ([key, game]) => {
      const missingImportResolution = resolveMissingSteamImport(
        game,
        remoteKeys.has(key)
      );

      return missingImportResolution
        ? [{ key, game: { ...game, ...missingImportResolution } }]
        : [];
    }
  );

  for (const updatesChunk of chunk(updates, MERGE_WRITE_CHUNK_SIZE)) {
    const batch = db.batch();

    for (const { key, game } of updatesChunk) {
      batch.put(key, game, { sublevel: gamesSublevel });
    }

    await batch.write();
  }
};

// Owner GETs do not hydrate a 200 response. Once removal fields already match,
// another probe cannot change import/visibility state; a positive full snapshot
// still reconciles and reactivates the game before orphan checks run.
const hasCompletedEpicRemoval = (game: Game) =>
  game.isDeleted === true &&
  game.hasActiveEpicImport === false &&
  game.epicImportScope === undefined &&
  game.epicPlayTimeInMilliseconds === 0;

const needsEpicOwnerProbe = (
  key: string,
  game: Game,
  remoteKeys: Set<string>
) =>
  game.shop === "epic" &&
  !!game.remoteId &&
  !remoteKeys.has(key) &&
  !hasPendingHydraClaim(key) &&
  (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0) <= 0 &&
  !hasCompletedEpicRemoval(game);

const reconcileMissingEpicGame = async (
  key: string,
  game: Game,
  remoteKeys: Set<string>,
  context: HydraApiAuthContext | null,
  current: () => boolean,
  networkOptions: Pick<HydraApiOptions, "signal" | "timeout">
) => {
  if (!current()) throw new Error("library-context-changed");
  const local = await gamesSublevel.get(key);
  if (!current()) throw new Error("library-context-changed");
  if (
    !local ||
    local.remoteId !== game.remoteId ||
    !needsEpicOwnerProbe(key, local, remoteKeys)
  )
    return;
  try {
    await HydraApi.get(
      `/profile/games/epic/${encodeURIComponent(game.objectId)}`,
      undefined,
      {
        ...networkOptions,
        ...(context ? { authContext: context } : {}),
        logResponseBody: false,
      }
    );
  } catch (error) {
    if (!current()) throw new Error("library-context-changed");
    if ((error as { response?: { status?: number } }).response?.status !== 404)
      return;
    await libraryWriteQueue.run(async () => {
      const latest = await gamesSublevel.get(key);
      if (
        !current() ||
        !latest ||
        latest.remoteId !== game.remoteId ||
        !needsEpicOwnerProbe(key, latest, remoteKeys)
      )
        return;
      await gamesSublevel.put(key, {
        ...latest,
        remoteId: null,
        epicPlayTimeInMilliseconds: 0,
        hasActiveEpicImport: false,
        epicImportScope: undefined,
        isDeleted: true,
      });
    }, current);
  }
  if (!current()) throw new Error("library-context-changed");
};

const mergeWithRemoteGamesOnce = async (
  onProgress?: RemoteGamesMergeProgress,
  capturedContext?: HydraApiAuthContext,
  expectedEpicConnectionId?: string,
  connectionCurrent: () => boolean = () => true,
  networkOptions: Pick<HydraApiOptions, "signal" | "timeout"> = {}
) => {
  const context = capturedContext ?? HydraApi.getAuthContext();
  const revision = getEpicLibraryConnectionRevision();
  const hydraRevision = getHydraPlaytimeRevision();
  const current = () =>
    (context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null) &&
    connectionCurrent() &&
    !networkOptions.signal?.aborted &&
    revision === getEpicLibraryConnectionRevision();
  try {
    if (!current()) return false;
    const canReconcileCustomArtwork =
      HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription();
    const remoteGames = await fetchRemoteGames(context, networkOptions);
    if (!current()) return false;
    let epicConnectionId = expectedEpicConnectionId;
    if (
      !epicConnectionId &&
      remoteGames.some((game) => game.hasActiveEpicImport)
    ) {
      const connection = await HydraApi.get<EpicConnection>(
        "/profile/integrations/epic",
        undefined,
        {
          ...networkOptions,
          ...(context ? { authContext: context } : {}),
          logResponseBody: false,
        }
      );
      if (!connection.connected) return false;
      epicConnectionId = connection.connectionId;
    }
    if (!current()) return false;
    const remoteKeys = new Set(
      remoteGames.map((game) => levelKeys.game(game.shop, game.objectId))
    );
    const candidates = (await gamesSublevel.iterator().all()).filter(
      ([key, game]) => needsEpicOwnerProbe(key, game, remoteKeys)
    );
    if (!current()) return false;
    const total = remoteGames.length + candidates.length;
    let processed = 0;

    onProgress?.(processed, total);

    for (const remoteChunk of chunk(remoteGames, MERGE_WRITE_CHUNK_SIZE)) {
      if (!current()) return false;
      await mergeRemoteGamesChunk(
        remoteChunk,
        canReconcileCustomArtwork,
        context,
        epicConnectionId,
        hydraRevision,
        current
      );
      if (!current()) return false;
      processed += remoteChunk.length;
      onProgress?.(processed, total);
    }

    // Keep installations, but hide games removed by destructive Steam cleanup.
    await libraryWriteQueue.run(
      () => hideGamesRemovedFromSteamImport(remoteKeys),
      current
    );

    if (!current()) return false;
    for (const batch of chunk(candidates, TARGETED_MERGE_CONCURRENCY)) {
      if (!current()) return false;
      const results = await Promise.allSettled(
        batch.map(async ([key, game]) => {
          await reconcileMissingEpicGame(
            key,
            game,
            remoteKeys,
            context,
            current,
            networkOptions
          );
          if (!current()) throw new Error("library-context-changed");
          processed++;
          onProgress?.(processed, total);
        })
      );
      if (!current() || results.some((result) => result.status === "rejected"))
        return false;
    }
    return current();
  } catch {
    // Keep local library available when remote sync fails.
    return false;
  }
};

// A connection transition invalidates old snapshots even when the Hydra user did not change.
export const mergeWithRemoteGames: typeof mergeWithRemoteGamesOnce = async (
  ...args
) => {
  const revision = getEpicLibraryConnectionRevision();
  const result = await mergeWithRemoteGamesOnce(...args);
  const context = args[1] ?? HydraApi.getAuthContext();
  if (
    !result &&
    revision !== getEpicLibraryConnectionRevision() &&
    (context
      ? HydraApi.isAuthContextCurrent(context)
      : HydraApi.getAuthContext() === null) &&
    (!args[3] || args[3]())
  )
    return mergeWithRemoteGamesOnce(...args);
  return result;
};

// Emulator imports already have catalogue assets and ROM metadata locally.
// Fetch only the profile-owned fields for the games touched by the import.
export const mergeImportedProfileGames = async (
  shop: Game["shop"],
  objectIds: string[]
) => {
  const uniqueObjectIds = Array.from(new Set(objectIds));

  for (const objectIdChunk of chunk(
    uniqueObjectIds,
    TARGETED_MERGE_CONCURRENCY
  )) {
    const remoteGames = await Promise.all(
      objectIdChunk.map(async (objectId) => {
        try {
          const remoteGame = await HydraApi.get<ImportedProfileGame>(
            `/profile/games/${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}`
          );

          if (remoteGame.shop !== shop || remoteGame.objectId !== objectId) {
            return null;
          }

          return remoteGame;
        } catch {
          return null;
        }
      })
    );

    for (const remoteGame of remoteGames) {
      if (!remoteGame) continue;
      const gameKey = levelKeys.game(remoteGame.shop, remoteGame.objectId);
      const localGame = await gamesSublevel.get(gameKey);
      if (!localGame) continue;
      await gamesSublevel.put(
        gameKey,
        mergeImportedProfileGame(localGame, remoteGame)
      );
    }
  }
};
