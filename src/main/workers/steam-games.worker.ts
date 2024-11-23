import type { SteamGame } from "@types";
import { slice } from "lodash-es";
import fs from "node:fs";

import { workerData } from "node:worker_threads";

const { steamGamesPath } = workerData;

const data = fs.readFileSync(steamGamesPath, "utf-8");

const steamGames = JSON.parse(data) as SteamGame[];

export const getById = (id: number) =>
  steamGames.find((game) => game.id === id);

export const list = ({ limit, offset }: { limit: number; offset: number }) =>
  slice(steamGames, offset, offset + limit);
