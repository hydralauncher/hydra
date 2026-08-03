import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";
import { gameExecutables } from "./process-watcher";

export class GameExecutables {
  static getExecutablesForGame(objectId: string): KnownGameExecutable[] | null {
    const executables = gameExecutables[objectId];

    if (!executables || executables.length === 0) {
      return null;
    }

    return executables.map((executable) => ({
      exe: executable.exe,
      name: executable.name,
    }));
  }

  static getAllObjectIds(): string[] {
    return Object.keys(gameExecutables);
  }
}
