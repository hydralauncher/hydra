import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";
import type { LibraryGame } from "@types";

type AppDispatch = ReturnType<typeof useAppDispatch>;

const LIBRARY_REQUEST_COALESCE_MS = 100;

let runningLibraryRequest: Promise<void> = Promise.resolve();
let pendingLibraryRequest: Promise<void> | null = null;

const waitForCoalescedRequests = () =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, LIBRARY_REQUEST_COALESCE_MS)
  );

const fetchLibrary = async (dispatch: AppDispatch) => {
  const serializedLibrary = await window.electron.getLibrarySerialized(true);
  dispatch(setLibrary(JSON.parse(serializedLibrary) as LibraryGame[]));
};

const requestLibraryUpdate = (dispatch: AppDispatch): Promise<void> => {
  pendingLibraryRequest ??= (async () => {
    await runningLibraryRequest.catch(() => undefined);
    await waitForCoalescedRequests();
    pendingLibraryRequest = null;
    runningLibraryRequest = fetchLibrary(dispatch);
    return runningLibraryRequest;
  })();
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
