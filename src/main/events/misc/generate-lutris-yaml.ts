import { Document as YMLDocument } from 'yaml';
import { Game } from '@main/entity';
import path from "node:path";

export function generateYML(game: Game) {
  const slugfiedGameTitle = game.title.replace(/\s/g, '-').toLocaleLowerCase();

  const doc = new YMLDocument({
    name: game.title,
    game_slug: slugfiedGameTitle,
    slug: `${slugfiedGameTitle}-installer`,
    version: 'Installer',
    runner: 'wine',
    script: {
      game: {
        prefix: '$GAMEDIR',
        arch: 'win64',
        working_dir: '$GAMEDIR'
      },
      installer: [{
        task: {
          name: "create_prefix",
          arch: "win64",
          prefix: "$GAMEDIR"
        }
      }, {
        task: {
          executable: path.join(game.downloadPath, game.folderName, 'setup.exe'),
          name: "wineexec",
          prefix: "$GAMEDIR"
        }
      }]
    }
  });

  return doc.toString();
}
