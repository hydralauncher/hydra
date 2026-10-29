import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";
import {
  initializeBigPictureRunningGamesStore,
  useBigPictureRunningGamesStore,
} from "../stores";

export function useRunningGameIds() {
  useEffect(() => {
    initializeBigPictureRunningGamesStore();
  }, []);

  return useBigPictureRunningGamesStore(
    useShallow((state) =>
      Object.keys(state.runningGamesById).sort((a, b) => a.localeCompare(b))
    )
  );
}
