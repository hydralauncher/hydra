import type { LudusaviBackup } from "@types";
import cp from "node:child_process";

import { workerData } from "node:worker_threads";

const { binaryPath } = workerData;

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
  return new Promise((resolve, reject) => {
    const args = ["backup", title, "--api", "--force"];

    if (preview) args.push("--preview");
    if (backupPath) args.push("--path", backupPath);
    if (winePrefix) args.push("--wine-prefix", winePrefix);

    cp.execFile(
      binaryPath,
      args,
      (err: cp.ExecFileException | null, stdout: string) => {
        if (err) {
          return reject(err);
        }

        return resolve(JSON.parse(stdout) as LudusaviBackup);
      }
    );
  });
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
