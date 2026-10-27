import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";
import type { LibraryGame } from "@types";

type AppDispatch = ReturnType<typeof useAppDispatch>;

let runningLibraryRequest: Promise<void> = Promise.resolve();
let pendingLibraryRequest: Promise<void> | null = null;

const requestLibraryUpdate = (dispatch: AppDispatch): Promise<void> => {
  pendingLibraryRequest ??= runningLibraryRequest
    .catch(() => {})
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))
    .then(() => {
      pendingLibraryRequest = null;
      runningLibraryRequest = window.electron
        .getLibrarySerialized(true)
        .then((serializedLibrary) => {
          dispatch(setLibrary(JSON.parse(serializedLibrary) as LibraryGame[]));
        });
      return runningLibraryRequest;
    });
  return pendingLibraryRequest;
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
