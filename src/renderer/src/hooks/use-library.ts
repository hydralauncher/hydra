import { useCallback } from "react";
import type { LibraryGame } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import type { AppDispatch } from "@renderer/store";
import { setLibrary } from "@renderer/features";

type SetLibraryAction = ReturnType<typeof setLibrary>;

let inFlight: Promise<SetLibraryAction> | null = null;
let trailing: Promise<SetLibraryAction> | null = null;

// Frozen rows let Immer skip deep-freezing every game on each library update.
const freezeGames = (games: LibraryGame[]): LibraryGame[] =>
  games.map((game) => Object.freeze(game));

const startLibraryUpdate = (dispatch: AppDispatch) => {
  const update = window.electron
    .getLibrary(true)
    .then((library) => dispatch(setLibrary(freezeGames(library))))
    .finally(() => {
      if (inFlight === update) inFlight = null;
    });
  inFlight = update;
  return update;
};

/**
 * Callers share the running library fetch. A caller arriving mid-fetch waits
 * for one follow-up fetch so it still observes writes made before its call.
 */
const requestLibraryUpdate = (dispatch: AppDispatch) => {
  if (inFlight === null) return startLibraryUpdate(dispatch);

  trailing ??= inFlight
    .catch(() => undefined)
    .then(() => {
      trailing = null;
      return inFlight ?? startLibraryUpdate(dispatch);
    });
  return trailing;
};

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);
  const downloadLibrary = useAppSelector(
    (state) => state.library.downloadLibrary
  );

  const updateLibrary = useCallback(
    () => requestLibraryUpdate(dispatch),
    [dispatch]
  );

  return { library, downloadLibrary, updateLibrary };
}
