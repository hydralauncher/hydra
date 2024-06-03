import path from "node:path";
import steamGamesWorkerPath from "./steam-games.worker?modulePath";
import repacksWorkerPath from "./repacks.worker?modulePath";
import downloadSourceWorkerPath from "./download-source.worker?modulePath";

import Piscina from "piscina";

import { seedsPath } from "@main/constants";

export const steamGamesWorker = new Piscina({
  filename: steamGamesWorkerPath,
  workerData: {
    steamGamesPath: path.join(seedsPath, "steam-games.json"),
  },
});

export const repacksWorker = new Piscina({
  filename: repacksWorkerPath,
});

export const downloadSourceWorker = new Piscina({
  filename: downloadSourceWorkerPath,
});
