import { registerEvent } from "../register-event";
import { mergeWithRemoteGames } from "@main/services";

const refreshLibraryAssets = async () => {
  if (!(await mergeWithRemoteGames())) {
    throw new Error("library/refresh-failed");
  }
};

registerEvent("refreshLibraryAssets", refreshLibraryAssets);
