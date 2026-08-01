import { logsPath } from "@main/constants";
import log from "electron-log";
import path from "path";

type DepthAwareTransport = log.Transport & { depth: number };

// Main-process logs reach DevTools through electron-log's IPC transport. Its
// default depth is too shallow for API payloads, turning array entries into
// "[object]" before the renderer can inspect them.
(log.transports.ipc as DepthAwareTransport).depth = 12;

log.transports.file.resolvePathFn = (
  _: log.PathVariables,
  message?: log.LogMessage | undefined
) => {
  if (message?.scope === "python-rpc") {
    return path.join(logsPath, "pythonrpc.txt");
  }

  if (message?.scope === "network") {
    return path.join(logsPath, "network.txt");
  }

  if (message?.scope == "achievements") {
    return path.join(logsPath, "achievements.txt");
  }

  if (message?.level === "error") {
    return path.join(logsPath, "error.txt");
  }

  if (message?.level === "info") {
    return path.join(logsPath, "info.txt");
  }

  return path.join(logsPath, "logs.txt");
};

log.errorHandler.startCatching({
  showDialog: false,
});

log.initialize();

export const pythonRpcLogger = log.scope("python-rpc");
export const logger = log.scope("main");
export const achievementsLogger = log.scope("achievements");
export const networkLogger = log.scope("network");
