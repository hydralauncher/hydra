import { gamesSublevel } from "@main/level";

import { createGameRecordUpdater } from "./game-record-updater-core";

import { libraryWriteQueue } from "./library-sync/library-write-queue";
const updater = createGameRecordUpdater(gamesSublevel);
export const updateGameRecord: typeof updater = (key, patch) =>
  libraryWriteQueue.run(() => updater(key, patch));
