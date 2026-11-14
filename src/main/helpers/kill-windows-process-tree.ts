import { execFile } from "node:child_process";
import path from "node:path";

import { logger } from "@main/services/logger";

/** Closes a Windows process and every process it started. */
export const killWindowsProcessTree = (pid: number, label: string) => {
  const taskkillPath = path.win32.join(
    process.env.SystemRoot || String.raw`C:\Windows`,
    "System32",
    "taskkill.exe"
  );

  execFile(
    taskkillPath,
    ["/PID", String(pid), "/T", "/F"],
    { shell: false, windowsHide: true },
    (error) => {
      if (error) logger.warn(`Failed to close ${label} process tree`, error);
    }
  );
};
