import type { LudusaviBackup } from "@types";
import cp from "node:child_process";

import { workerData } from "node:worker_threads";

const { binaryPath } = workerData;

let backupGameProcess: cp.ChildProcess | null = null;

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
  if (backupGameProcess && !backupGameProcess.killed) {
    backupGameProcess.kill();
    backupGameProcess = null;
  }

  return new Promise((resolve, reject) => {
    const args = ["backup", title, "--api", "--force"];

    if (preview) args.push("--preview");
    if (backupPath) args.push("--path", backupPath);
    if (winePrefix) args.push("--wine-prefix", winePrefix);

    backupGameProcess = cp.execFile(
      binaryPath,
      args,
      (err: cp.ExecFileException | null, stdout: string) => {
        if (err) {
          backupGameProcess = null;
          return reject(err);
        }

        backupGameProcess = null;
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
