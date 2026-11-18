import type { Game } from "@types";

export interface ClearedExecutable {
  title: string;
  executablePath: string;
  iconUrl: string | null;
}

export const collectClearedExecutables = (
  libraryGames: { key: string; game: Game }[],
  clearedKeys: ReadonlySet<string>
) => {
  const clearedExecutables = new Map<string, ClearedExecutable>();

  for (const { key, game } of libraryGames) {
    if (!clearedKeys.has(key) || !game.executablePath) continue;

    clearedExecutables.set(key, {
      title: game.title,
      executablePath: game.executablePath,
      iconUrl: game.iconUrl ?? null,
    });
  }

  return clearedExecutables;
};

// A cleared game that was linked again in the same scan was moved, not removed
export const findUnlinkedGames = async (
  clearedExecutables: Map<string, ClearedExecutable>,
  getGames: (keys: string[]) => Promise<(Game | undefined)[]>
) => {
  const entries = [...clearedExecutables];
  const games = await getGames(entries.map(([key]) => key));

  return entries.flatMap(([_key, clearedExecutable], index) =>
    games[index]?.executablePath ? [] : [clearedExecutable]
  );
};
