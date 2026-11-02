import { registerEvent } from "../register-event";
import { mergeWithRemoteGamesUnlessFresh } from "@main/services";

// Opening the library repeatedly should not refetch every remote page each time.
const REMOTE_LIBRARY_FRESH_MS = 60_000;

const refreshLibraryAssets = async () => {
  if (!(await mergeWithRemoteGamesUnlessFresh(REMOTE_LIBRARY_FRESH_MS))) {
    throw new Error("library/refresh-failed");
  }
};

registerEvent("refreshLibraryAssets", refreshLibraryAssets);
