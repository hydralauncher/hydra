import type { GameShop, LudusaviBackup, LudusaviFindResult } from "@types";
import cp from "node:child_process";

import { workerData } from "node:worker_threads";

const { binaryPath } = workerData;

export const findGames = ({
  shop,
  objectId,
}: {
  shop: GameShop;
  objectId: string;
}) => {
  const args = ["find", "--api"];

  if (shop === "steam") {
    args.push("--steam-id", objectId);
  }

  const result = cp.execFileSync(binaryPath, args);

  const games = JSON.parse(result.toString("utf-8")) as LudusaviFindResult;
  return Object.keys(games.games);
};

export const backupGame = ({
  title,
  backupPath,
  preview = false,
  winePrefix,
}: {
  title: string;
  backupPath: string;
  preview?: boolean;
  winePrefix?: string;
}) => {
  const args = ["backup", `"${title}"`, "--api", "--force"];

  if (preview) args.push("--preview");
  if (backupPath) args.push("--path", backupPath);
  if (winePrefix) args.push("--wine-prefix", winePrefix);

  const result = cp.execFileSync(binaryPath, args);

  return JSON.parse(result.toString("utf-8")) as LudusaviBackup;
};

export const restoreBackup = (backupPath: string) => {
  const result = cp.execFileSync(binaryPath, [
    "restore",
    "--path",
    backupPath,
    "--api",
    "--force",
  ]);

  return JSON.parse(result.toString("utf-8")) as LudusaviBackup;
};

export const generateConfig = () => {
  const result = cp.execFileSync(binaryPath, ["schema", "config"]);

  return JSON.parse(result.toString("utf-8")) as LudusaviBackup;
};
