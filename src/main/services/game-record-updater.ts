import { gamesSublevel } from "@main/level";

import { createGameRecordUpdater } from "./game-record-updater-core";

export const updateGameRecord = createGameRecordUpdater(gamesSublevel);
