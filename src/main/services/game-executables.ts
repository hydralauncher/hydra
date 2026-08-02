import { gameExecutables } from "./process-watcher";

export interface GameExecutableEntry {
  objectId: string;
  relativePath: string;
  fileName: string;
}

const normalizePath = (value: string) =>
  value.replace(/\\/g, "/").toLowerCase();

export class GameExecutables {
  static getExecutablesForGame(objectId: string): string[] | null {
    const executables = gameExecutables[objectId];

    if (!executables || executables.length === 0) {
      return null;
    }

    return executables.map((exe) => exe.exe);
  }

  static getEntriesForGame(objectId: string): GameExecutableEntry[] {
    const executables = gameExecutables[objectId] ?? [];

    return executables.map((executable) => ({
      objectId,
      relativePath: normalizePath(executable.name),
      fileName: normalizePath(executable.exe),
    }));
  }

  static getAllEntries(): GameExecutableEntry[] {
    return Object.keys(gameExecutables).flatMap((objectId) =>
      GameExecutables.getEntriesForGame(objectId)
    );
  }
}
