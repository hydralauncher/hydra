import { registerEvent } from "../register-event";
import { mergeWithRemoteGames } from "@main/services";

const refreshLibraryAssets = async () => {
  await mergeWithRemoteGames();
};

registerEvent("refreshLibraryAssets", refreshLibraryAssets);
