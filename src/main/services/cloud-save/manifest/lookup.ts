import type { GameShop } from "@types";

import { gamesSublevel, levelKeys } from "@main/level";

import type { HydraManifestGameEntry, HydraManifestIndex } from "./types";

type ManifestLookupGameData = {
  title?: string;
  remoteId?: string | null;
};

const normalizeManifestKey = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

const getManifestLookupGameData = async (
  shop: GameShop,
  objectId: string
): Promise<ManifestLookupGameData | null> => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

    if (!game || game.isDeleted) {
      return null;
    }

    return {
      title: game.title,
      remoteId: game.remoteId,
    };
  } catch {
    return null;
  }
};

const buildManifestLookupCandidates = (
  objectId: string,
  gameData: ManifestLookupGameData | null
): string[] => {
  const candidates = [objectId, gameData?.remoteId, gameData?.title].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  return Array.from(new Set(candidates));
};

export const findManifestEntryForGame = async (
  index: HydraManifestIndex,
  shop: GameShop,
  objectId: string
): Promise<HydraManifestGameEntry | null> => {
  const gameData = await getManifestLookupGameData(shop, objectId);
  const candidates = buildManifestLookupCandidates(objectId, gameData);

  for (const candidate of candidates) {
    const exactMatch = index.games[candidate];

    if (exactMatch) return exactMatch;
  }

  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeManifestKey(candidate))
  );

  for (const [manifestKey, manifestEntry] of Object.entries(index.games)) {
    if (normalizedCandidates.has(normalizeManifestKey(manifestKey))) {
      return manifestEntry;
    }
  }

  return null;
};
