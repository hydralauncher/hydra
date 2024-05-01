import { Document as YMLDocument } from "yaml";
import { Game } from "@main/entity";
import path from "node:path";
import fs from "node:fs";

export const generateYML = (game: Game) => {
  const slugifiedGameTitle = game.title.replace(/\s/g, "-").toLocaleLowerCase();
  const gamePath = path.join(game.downloadPath, game.folderName);

  const files = fs.readdirSync(gamePath);
  const setupFileName = files.find(file => /^setup\.exe$/i.test(file));
  const setupPath = setupFileName ? path.join(gamePath, setupFileName) : null;

  const doc = new YMLDocument({
    name: game.title,
    game_slug: slugifiedGameTitle,
    slug: `${slugifiedGameTitle}-installer`,
    version: "Installer",
    runner: "wine",
    script: {
      game: {
        prefix: "$GAMEDIR",
        arch: "win64",
        working_dir: "$GAMEDIR",
      },
      installer: [
        {
          task: {
            name: "create_prefix",
            arch: "win64",
            prefix: "$GAMEDIR",
          },
        },
        {
          task: {
            executable: setupPath, 
            name: "wineexec",
            prefix: "$GAMEDIR",
          },
        },
      ],
    },
  });

  return doc.toString();
};