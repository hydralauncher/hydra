import { gameExecutables } from "./process-watcher";

export class GameExecutables {
  static getExecutablesForGame(objectId: string): string[] | null {
    const executables = gameExecutables[objectId];

    if (!executables || executables.length === 0) {
      return null;
    }

    return executables.map((exe) => exe.exe);
  }
}
