import { create } from "zustand";
import type { GameRunning } from "@types";

export type BigPictureRunningGame = Pick<
  GameRunning,
  "id" | "sessionDurationInMillis"
>;

interface BigPictureRunningGamesStoreState {
  runningGamesById: Record<string, BigPictureRunningGame>;
  setRunningGames: (games: BigPictureRunningGame[]) => void;
}

export const useBigPictureRunningGamesStore =
  create<BigPictureRunningGamesStoreState>((set) => ({
    runningGamesById: {},
    setRunningGames: (games) => {
      set({
        runningGamesById: Object.fromEntries(
          games.map((game) => [game.id, game])
        ),
      });
    },
  }));

let runningGamesStoreInitialized = false;

export function initializeBigPictureRunningGamesStore() {
  if (runningGamesStoreInitialized) return;
  if (typeof globalThis.window === "undefined") return;

  const electron = globalThis.window.electron;
  if (!electron || typeof electron.onGamesRunning !== "function") return;

  runningGamesStoreInitialized = true;

  // Ports report under the base game's id; Big Picture has no port pages yet.
  const setRunningGames = (
    games: (BigPictureRunningGame & Pick<GameRunning, "recompilationSlug">)[]
  ) => {
    useBigPictureRunningGamesStore
      .getState()
      .setRunningGames(games.filter((game) => !game.recompilationSlug));
  };

  if (typeof electron.getGamesRunning === "function") {
    electron
      .getGamesRunning()
      .then(setRunningGames)
      .catch(() => {});
  }

  electron.onGamesRunning(setRunningGames);
}
