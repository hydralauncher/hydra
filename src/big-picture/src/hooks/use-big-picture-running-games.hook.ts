import { useEffect } from "react";
import {
  initializeBigPictureRunningGamesStore,
  useBigPictureRunningGamesStore,
} from "../stores";

export function useBigPictureRunningGames() {
  useEffect(() => {
    initializeBigPictureRunningGamesStore();
  }, []);

  return useBigPictureRunningGamesStore((state) => state.runningGamesById);
}

export function useBigPictureRunningGame(gameId?: string | null) {
  useEffect(() => {
    initializeBigPictureRunningGamesStore();
  }, []);

  return useBigPictureRunningGamesStore((state) =>
    gameId ? (state.runningGamesById[gameId] ?? null) : null
  );
}

export function useIsBigPictureGameRunning(gameId?: string | null) {
  return useBigPictureRunningGame(gameId) !== null;
}
