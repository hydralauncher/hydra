import path from "node:path";
import steamGamesWorkerPath from "./steam-games.worker?modulePath";

import Piscina from "piscina";

import { seedsPath } from "@main/constants";

export const steamGamesWorker = new Piscina({
  filename: steamGamesWorkerPath,
  workerData: {
    steamGamesPath: path.join(seedsPath, "steam-games.json"),
  },
  maxThreads: 1,
});
