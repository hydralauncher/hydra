import { Document as YMLDocument } from 'yaml';
import { Game } from '@main/entity';

export function generateYML(game: Game) {
  const slugfiedName = game.title.replace(/\s/g, '-').toLocaleLowerCase();

  const doc = new YMLDocument({
    name: game.title,
    game_slug: slugfiedName,
    slug: `${slugfiedName}-installer`,
    version: 'Installer',
    runner: 'wine',
    script: {
      installer: [{
        task: {
          name: "create_prefix",
          arch: "win64",
          prefix: "$GAMEDIR/prefix"
        }
      }, {
        task: {
          executable: `${game.downloadPath}/${game.folderName}/setup.exe`,
          name: "wineexec",
          prefix: "$GAMEDIR/prefix"
        }
      }]
    }
  });

  return doc.toString();
}
