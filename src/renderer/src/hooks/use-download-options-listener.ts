import { useEffect } from "react";
import { useAppDispatch } from "./redux";
import { updateGameNewDownloadOptions } from "@renderer/features";

export function useDownloadOptionsListener() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unsubscribe = window.electron.onNewDownloadOptions(
      (gamesWithNewOptions) => {
        for (const { gameId, count } of gamesWithNewOptions) {
          dispatch(updateGameNewDownloadOptions({ gameId, count }));
        }
      }
    );

    return unsubscribe;
  }, [dispatch]);
}
