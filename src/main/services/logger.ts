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
  switch (message?.level) {
    case "error":
      return path.join(logsPath, "error.txt");
    case "info":
      return path.join(logsPath, "info.txt");
    default:
      return path.join(logsPath, "logs.txt");
  }
};

log.errorHandler.startCatching({
  showDialog: false,
});

log.initialize();

export const logger = log.scope("main");
