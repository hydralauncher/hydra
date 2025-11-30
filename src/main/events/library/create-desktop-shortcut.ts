import { ipcMain } from "electron";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { XDGPath } from "@main/services/xdg-path";
import fs from "node:fs";
import path from "node:path";
import { createHydraLauncherScript } from "@main/services/steam";

ipcMain.handle(
  "createDesktopShortcut",
  async (_, shop: GameShop, objectId: string) => {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    if (!game) throw new Error("Game not found");

    const launcherPath = createHydraLauncherScript(game.objectId);

    const desktopEntry = `[Desktop Entry]
Name=${game.title}
Exec=${launcherPath}
Icon=${game.iconUrl ?? ""}
Type=Application
Categories=Game;`;

    const desktopPath = path.join(
      XDGPath.getPath("data"),
      "applications",
      `${game.objectId}.desktop`
    );
    fs.writeFileSync(desktopPath, desktopEntry);
  }
);
