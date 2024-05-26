import { app } from "electron";
import log from "electron-log";
import path from "path";

const logsPath = app.isPackaged
  ? path.join(app.getAppPath(), "..", "..", "logs")
  : path.join(app.getAppPath(), "logs");

log.transports.file.resolvePathFn = (
  _: log.PathVariables,
  message?: log.LogMessage | undefined
) => {
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

export const logger = log.scope("main");
