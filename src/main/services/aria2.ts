import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";

export const startAria2 = (): Promise<ChildProcessWithoutNullStreams> => {
  return new Promise((resolve) => {
    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, "aria2", "aria2c")
      : path.join(__dirname, "..", "..", "aria2", "aria2c");

    const cp = spawn(binaryPath, [
      "--enable-rpc",
      "--rpc-listen-all",
      "--file-allocation=none",
      "--allow-overwrite=true",
    ]);

    cp.stdout.on("data", async (data) => {
      const msg = Buffer.from(data).toString("utf-8");

      if (msg.includes("IPv6 RPC: listening on TCP")) {
        resolve(cp);
      }
    });
  });
};
