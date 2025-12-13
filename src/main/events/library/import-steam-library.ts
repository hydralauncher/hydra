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

const updateSteamLibrary = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<number> => {
  console.log("🔄️ Updating Steam library ");
  const steamImporter = new SteamImporter();
  await steamImporter.initialize({ steamPath: undefined });
  const apps = await steamImporter.scanLibraries();

  // Buscar todos os jogos Steam já importados
  const importedGames = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([_key, game]) =>
            game.shop === "steam" && game.isImported === true && !game.isDeleted
        )
        .map(([_key, game]) => ({
          appid: game.objectId,
          gameKey: levelKeys.game("steam", game.objectId),
          game,
        }))
    );

  const importedAppIds = new Set(importedGames.map((g) => g.appid));
  const installedAppIds = new Set(
    (apps as any[])
      .filter((app) => app.isInstalled !== false)
      .map((app) => app.appid)
  );

  let newGamesCount = 0;
  let removedGamesCount = 0;

  // Adicionar jogos novos
  for (const app of apps as any[]) {
    // Pular jogos que não estão instalados
    if (app.isInstalled === false) {
      continue;
    }

    // Se o jogo já foi importado, pular
    if (importedAppIds.has(app.appid)) {
      continue;
    }

    // Importar apenas jogos novos
    const gameKey = levelKeys.game("steam", app.appid);
    await addGameToLibrary(_event, "steam", app.appid, app.name);
    const game = await gamesSublevel.get(gameKey);
    if (game) {
      await gamesSublevel.put(gameKey, {
        ...game,
        isImported: true,
        executablePath: `steam://rungameid/${app.appid}`,
      });
      newGamesCount++;
    }
  }

  // Remover jogos desinstalados
  for (const importedGame of importedGames) {
    // Se o jogo não está mais instalado (não está na lista de instalados)
    if (!installedAppIds.has(importedGame.appid)) {
      const game = await gamesSublevel.get(importedGame.gameKey);
      if (game && !game.isDeleted) {
        await gamesSublevel.put(importedGame.gameKey, {
          ...game,
          isDeleted: true,
        });
        removedGamesCount++;
      }
    }
  }

  console.log(
    `✅ Steam library updated. ${newGamesCount} new games imported, ${removedGamesCount} games removed`
  );
  return newGamesCount;
};

registerEvent("importSteamLibrary", importSteamLibrary);
registerEvent("updateSteamLibrary", updateSteamLibrary);
