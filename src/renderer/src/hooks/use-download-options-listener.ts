import { useEffect } from "react";
import { useAppDispatch } from "./redux";
import { updateGameNewDownloadOptions } from "@renderer/features";

export function useDownloadOptionsListener() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unsubscribe = window.electron.onNewDownloadOptions(
      (gamesWithNewOptions) => {
        gamesWithNewOptions.forEach(({ gameId, count }) => {
          dispatch(updateGameNewDownloadOptions({ gameId, count }));
        });
      }
    );

    return unsubscribe;
  }, [dispatch]);
}