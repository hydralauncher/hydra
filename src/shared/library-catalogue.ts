import type {
  CatalogueGameIdentity,
  GameShop,
  LibraryCatalogueMetadata,
  LibraryGame,
  LibraryGamePresentation,
} from "@types";
import { getLibraryCollectionIds } from "./library-group-actions.js";

type RunningGameIds = readonly string[] | ReadonlySet<string>;

export const isLibraryGamePresentation = (
  game: LibraryGame
): game is LibraryGamePresentation =>
  "members" in game && Array.isArray(game.members) && "operationalGame" in game;

export const getLibraryOperationalGame = (game: LibraryGame): LibraryGame =>
  isLibraryGamePresentation(game) ? game.operationalGame : game;

export const getLibraryGameMembers = (game: LibraryGame): LibraryGame[] =>
  isLibraryGamePresentation(game) ? game.members : [game];

export const getGameCatalogueIdentity = (
  game: CatalogueGameIdentity & LibraryCatalogueMetadata
): CatalogueGameIdentity =>
  game.catalogueGame ?? { shop: game.shop, objectId: game.objectId };

/** Individual responses and older APIs may omit catalogue metadata. */
export const mergeLibraryCatalogueMetadata = (
  local: LibraryCatalogueMetadata | undefined,
  remote: LibraryCatalogueMetadata
): LibraryCatalogueMetadata => ({
  canonicalId: remote.canonicalId ?? local?.canonicalId,
  catalogueGame: remote.catalogueGame ?? local?.catalogueGame,
  availableShops: remote.availableShops ?? local?.availableShops,
});

const identityKey = ({ shop, objectId }: CatalogueGameIdentity) =>
  `${shop}:${objectId}`;

const storePriority = (shop: GameShop) => (shop === "steam" ? 0 : 1);

export const selectOperationalLibraryGame = (
  games: readonly LibraryGame[],
  runningIds: RunningGameIds = []
): LibraryGame => {
  const running = new Set(runningIds);
  return [...games].sort(
    (a, b) =>
      Number(running.has(b.id) || running.has(identityKey(b))) -
        Number(running.has(a.id) || running.has(identityKey(a))) ||
      Number(Boolean(b.executablePath)) - Number(Boolean(a.executablePath)) ||
      storePriority(a.shop) - storePriority(b.shop) ||
      identityKey(a).localeCompare(identityKey(b))
  )[0];
};

export const isLibraryGameDownloading = (
  game:
    | { download?: { status?: string | null; extracting?: boolean } | null }
    | null
    | undefined
): boolean =>
  game?.download?.status === "active" ||
  game?.download?.status === "extracting" ||
  game?.download?.extracting === true;

const downloadPriority = (game: LibraryGame) => {
  if (isLibraryGameDownloading(game)) return 3;
  if (game.download?.queued || game.download?.status === "waiting") return 2;
  if (game.download?.status === "paused" || game.download?.status === "error")
    return 1;
  return 0;
};

export const selectDownloadLibraryGame = (
  games: readonly LibraryGame[],
  operationalGame: LibraryGame
): LibraryGame =>
  [...games]
    .filter((game) => downloadPriority(game) > 0)
    .sort(
      (a, b) =>
        downloadPriority(b) - downloadPriority(a) ||
        Number(identityKey(b) === identityKey(operationalGame)) -
          Number(identityKey(a) === identityKey(operationalGame)) ||
        storePriority(a.shop) - storePriority(b.shop) ||
        identityKey(a).localeCompare(identityKey(b))
    )[0] ?? operationalGame;

const latestDate = (values: (Date | null)[]): Date | null =>
  values.reduce<Date | null>((latest, value) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return latest;
    return !latest || new Date(value) > new Date(latest) ? value : latest;
  }, null);

const earliestDate = (values: (Date | null | undefined)[]): Date | null =>
  values.reduce<Date | null>((earliest, value) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return earliest;
    return !earliest || new Date(value) < new Date(earliest) ? value : earliest;
  }, null);

const projectGroup = (
  members: LibraryGame[],
  runningIds: RunningGameIds
): LibraryGamePresentation => {
  const operationalGame = selectOperationalLibraryGame(members, runningIds);
  const candidates = members.map(getGameCatalogueIdentity);
  const catalogueGame =
    candidates.find((identity) => identity.shop === "steam") ?? candidates[0];
  const presentationGame =
    members.find(
      (member) => identityKey(member) === identityKey(catalogueGame)
    ) ??
    members.find(
      (member) =>
        identityKey(getGameCatalogueIdentity(member)) ===
        identityKey(catalogueGame)
    ) ??
    operationalGame;
  const availableShops = Array.from(
    new Set(members.flatMap((member) => member.availableShops ?? [member.shop]))
  ).sort((a, b) => storePriority(a) - storePriority(b));
  const customCandidates = [operationalGame, presentationGame, ...members];
  const custom = <
    K extends
      | "customIconUrl"
      | "customLogoImageUrl"
      | "customHeroImageUrl"
      | "customCoverImageUrl",
  >(
    field: K
  ) => customCandidates.find((member) => member[field])?.[field] ?? null;
  const sum = (
    field:
      | "playTimeInMilliseconds"
      | "steamPlayTimeInMilliseconds"
      | "epicPlayTimeInMilliseconds"
  ) =>
    members.reduce(
      (total, member) => total + Math.max(0, member[field] ?? 0),
      0
    );

  return {
    ...operationalGame,
    canonicalId:
      presentationGame.canonicalId ??
      members.find((member) => member.canonicalId)?.canonicalId,
    title: presentationGame.title,
    iconUrl: presentationGame.iconUrl,
    logoImageUrl: presentationGame.logoImageUrl,
    libraryHeroImageUrl: presentationGame.libraryHeroImageUrl,
    libraryImageUrl: presentationGame.libraryImageUrl,
    coverImageUrl: presentationGame.coverImageUrl,
    logoPosition: presentationGame.logoPosition,
    downloadSources: presentationGame.downloadSources,
    achievementCount: operationalGame.achievementCount,
    unlockedAchievementCount: operationalGame.unlockedAchievementCount,
    customIconUrl: custom("customIconUrl"),
    customLogoImageUrl: custom("customLogoImageUrl"),
    customHeroImageUrl: custom("customHeroImageUrl"),
    customCoverImageUrl: custom("customCoverImageUrl"),
    members,
    operationalGame,
    achievementGame: operationalGame,
    downloadGame: selectDownloadLibraryGame(members, operationalGame),
    catalogueGame,
    availableShops,
    playTimeInMilliseconds: sum("playTimeInMilliseconds"),
    steamPlayTimeInMilliseconds: sum("steamPlayTimeInMilliseconds"),
    epicPlayTimeInMilliseconds: sum("epicPlayTimeInMilliseconds"),
    hasActiveSteamImport: members.some((member) => member.hasActiveSteamImport),
    hasActiveEpicImport: members.some((member) => member.hasActiveEpicImport),
    favorite: members.some((member) => member.favorite),
    isPinned: members.some((member) => member.isPinned),
    pinnedDate: latestDate(members.map((member) => member.pinnedDate ?? null)),
    isConcealed: members.every((member) => member.isConcealed),
    isHiddenFromOthers: members.some((member) => member.isHiddenFromOthers),
    collectionIds: Array.from(
      new Set(members.flatMap(getLibraryCollectionIds))
    ),
    lastTimePlayed: latestDate(members.map((member) => member.lastTimePlayed)),
    addedToLibraryAt: earliestDate(
      members.map((member) => member.addedToLibraryAt)
    ),
  };
};

/** Groups only confirmed catalogue links; never merges the stored records. */
export const groupLibraryGames = (
  games: readonly LibraryGame[],
  runningIds: RunningGameIds = []
): LibraryGamePresentation[] => {
  const groups = new Map<string, LibraryGame[]>();
  const seen = new Set<string>();
  const confirmedIdentities = new Map<string, Set<string>>();
  for (const game of games) {
    if (
      game.isDeleted ||
      !game.canonicalId ||
      (game.shop !== "steam" && game.shop !== "epic")
    )
      continue;
    const key = identityKey(getGameCatalogueIdentity(game));
    const canonicalIds = confirmedIdentities.get(key) ?? new Set<string>();
    canonicalIds.add(game.canonicalId);
    confirmedIdentities.set(key, canonicalIds);
  }
  for (const game of games) {
    const identity = identityKey(game);
    if (game.isDeleted || seen.has(identity)) continue;
    seen.add(identity);
    const confirmed = confirmedIdentities.get(identity);
    const canonicalId =
      game.canonicalId ??
      (confirmed?.size === 1 ? [...confirmed][0] : undefined);
    const groupKey =
      (game.shop === "steam" || game.shop === "epic") && canonicalId
        ? `catalogue:${canonicalId}`
        : identity;
    const group = groups.get(groupKey) ?? [];
    group.push(game);
    groups.set(groupKey, group);
  }
  return [...groups.values()].map((members) =>
    projectGroup(members, runningIds)
  );
};

export const findLibraryGamePresentation = (
  games: readonly LibraryGame[],
  identity: CatalogueGameIdentity,
  runningIds: RunningGameIds = []
): LibraryGamePresentation | undefined => {
  const groups = groupLibraryGames(games, runningIds);
  const owned = groups.find((group) =>
    group.members.some(
      (member) => identityKey(member) === identityKey(identity)
    )
  );
  if (owned) return owned;
  const matching = groups.filter(
    (group) => identityKey(group.catalogueGame) === identityKey(identity)
  );
  return matching.length === 1 ? matching[0] : undefined;
};
