import { logsPath } from "@main/constants";
import log from "electron-log";
import path from "path";

type DepthAwareTransport = log.Transport & { depth: number };

const networkLog = log.create({ logId: "network" });
(networkLog.transports.ipc as DepthAwareTransport).depth = 12;
networkLog.transports.file.resolvePathFn = () =>
  path.join(logsPath, "network.txt");

log.transports.file.resolvePathFn = (
  _: log.PathVariables,
  message?: log.LogMessage | undefined
) => {
  if (message?.scope === "python-rpc") {
    return path.join(logsPath, "pythonrpc.txt");
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
export const networkLogger = networkLog.scope("network");
