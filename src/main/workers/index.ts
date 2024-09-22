import path from "node:path";
import steamGamesWorkerPath from "./steam-games.worker?modulePath";
import downloadSourcesWorkerPath from "./download-sources.worker?modulePath";

import Piscina from "piscina";

import { seedsPath } from "@main/constants";

export const steamGamesWorker = new Piscina({
  filename: steamGamesWorkerPath,
  workerData: {
    steamGamesPath: path.join(seedsPath, "steam-games.json"),
  },
  maxThreads: 1,
});

export const downloadSourcesWorker = new Piscina({
  filename: downloadSourcesWorkerPath,
});
