import type { Game } from "@types";

const TITLE_ID = /^[A-Z]{4}\d{5}$/;

// Some editions retain the original release's savedata directory ID.
// These associations apply to savedata only, never to media or savestates.
const SAVEDATA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BLUS30902: ["BLUS30522"],
};

export const normalizeRpcs3TitleId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return TITLE_ID.test(normalized) ? normalized : null;
};

export const rpcs3TitleIdsForGame = (game: Game): string[] =>
  [
    ...new Set(
      (game.discs ?? []).map((disc) => normalizeRpcs3TitleId(disc.sku))
    ),
  ].filter((id): id is string => id !== null);

export const expandRpcs3SavedataTitleIds = (
  titleIds: Iterable<unknown>
): string[] => {
  const ids = new Set(
    [...titleIds]
      .map(normalizeRpcs3TitleId)
      .filter((id): id is string => id !== null)
  );
  for (const id of [...ids]) {
    for (const alias of SAVEDATA_ALIASES[id] ?? []) ids.add(alias);
  }
  return [...ids].sort();
};

export const rpcs3SavedataTitleIdsForGame = (
  game: Game,
  catalogueTitleIds: Iterable<unknown> = []
): string[] => {
  const discIds = rpcs3TitleIdsForGame(game);
  if (!discIds.length) return [];
  return expandRpcs3SavedataTitleIds([...discIds, ...catalogueTitleIds]);
};
