import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import addGameToLibrary from "./add-game-to-library";
import SteamImporter from "@main/services/importer/steam/steam-importer";

const importSteamLibrary = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<void> => {
  console.log("🔄️ Importing Steam library ");
  const steamImporter = new SteamImporter();
  await steamImporter.initialize({ steamPath: undefined });
  const apps = await steamImporter.scanLibraries();
  for (const app of apps as any[]) {
    const gameKey = levelKeys.game("steam", app.appid);
    await addGameToLibrary(_event, "steam", app.appid, app.name);
    const game = await gamesSublevel.get(gameKey);
    if (game) {
      console.log("Game", game);
      await gamesSublevel.put(gameKey, {
        ...game,
        isImported: true,
        executablePath: `steam://rungameid/${app.appid}`,
      });
    }
  }

  console.log("Steam library imported");
};

registerEvent("importSteamLibrary", importSteamLibrary);
