export const SIMILAR_GAMES_COLLAPSED_STORAGE_KEY = "similar-games-collapsed";

interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const getDefaultStorage = (): StringStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const readSimilarGamesCollapsed = (
  storage: StringStorage | null = getDefaultStorage()
): boolean => {
  try {
    return storage?.getItem(SIMILAR_GAMES_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const storeSimilarGamesCollapsed = (
  isCollapsed: boolean,
  storage: StringStorage | null = getDefaultStorage()
) => {
  try {
    storage?.setItem(
      SIMILAR_GAMES_COLLAPSED_STORAGE_KEY,
      isCollapsed ? "true" : "false"
    );
  } catch {
    // Persisting the preference is best-effort.
  }
};
