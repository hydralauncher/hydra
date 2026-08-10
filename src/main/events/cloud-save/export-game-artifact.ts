import { logger, SevenZip, WindowManager } from "@main/services";
import type { LegacySaveExportProgress, LegacySaveExportResult } from "@types";
import axios from "axios";
import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { registerEvent } from "../register-event";
import {
  exportGameArtifactArchive,
  sanitizeLegacySaveArchiveName,
} from "./export-game-artifact-operation";
import { requestGameArtifactDownload } from "./game-artifact-download";
import { gameArtifactExportCoordinator } from "./game-artifact-export-coordinator";

const UNKNOWN_TOTAL_PROGRESS_REPORT_INTERVAL_BYTES = 1024 * 1024;

const exportGameArtifact = async (
  event: Electron.IpcMainInvokeEvent,
  operationId: string,
  gameArtifactId: string,
  suggestedName: string
): Promise<LegacySaveExportResult> => {
  if (!operationId)
    throw new Error("Legacy save export operation ID is required");

  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ??
    WindowManager.mainWindow ??
    null;

  if (!senderWindow) {
    throw new Error("Unable to open the legacy save export dialog");
  }

  const archiveName = sanitizeLegacySaveArchiveName(suggestedName);
  const abortController = gameArtifactExportCoordinator.start(event.sender.id);

  if (!abortController) return { status: "busy" };

  const { signal } = abortController;
  const sendProgress = (progress: LegacySaveExportProgress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("on-game-artifact-export-progress", {
        operationId,
        ...progress,
      });
    }
  };

  try {
    return await exportGameArtifactArchive({
      signal,
      createTemporaryDirectory: () =>
        fs.promises.mkdtemp(
          path.join(app.getPath("temp"), "hydra-legacy-save-")
        ),
      downloadTar: async (destinationPath) => {
        const { downloadUrl } = await requestGameArtifactDownload(
          gameArtifactId,
          signal
        );
        const response = await axios.get<Readable>(downloadUrl, {
          responseType: "stream",
          signal,
        });

        const rawTotalBytes = Number(response.headers["content-length"]);
        const totalBytes =
          Number.isFinite(rawTotalBytes) && rawTotalBytes > 0
            ? rawTotalBytes
            : null;
        let downloadedBytes = 0;
        let lastReportedPercentage = -1;
        let lastReportedBytes = -1;

        const reportProgress = (force = false) => {
          const percentage = totalBytes
            ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
            : null;
          const shouldReportKnownTotal =
            percentage !== null && percentage !== lastReportedPercentage;
          const shouldReportUnknownTotal =
            percentage === null &&
            (lastReportedBytes < 0 ||
              downloadedBytes - lastReportedBytes >=
                UNKNOWN_TOTAL_PROGRESS_REPORT_INTERVAL_BYTES);

          if (!force && !shouldReportKnownTotal && !shouldReportUnknownTotal) {
            return;
          }

          lastReportedPercentage = percentage ?? -1;
          lastReportedBytes = downloadedBytes;
          sendProgress({ downloadedBytes, totalBytes, percentage });
        };

        const progressStream = new Transform({
          transform(chunk, _encoding, callback) {
            downloadedBytes += Buffer.byteLength(chunk);
            reportProgress();
            callback(null, chunk);
          },
        });

        reportProgress(true);

        await pipeline(
          response.data,
          progressStream,
          fs.createWriteStream(destinationPath, { flags: "wx" }),
          { signal }
        );
        reportProgress(true);
      },
      extractTar: async (tarPath, destinationPath) => {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        await pipeline(
          fs.createReadStream(tarPath),
          tar.x({ cwd: destinationPath }),
          { signal }
        );
      },
      createZip: (sourcePath, destinationPath) =>
        SevenZip.createZip({ sourcePath, destinationPath, signal }),
      selectDestination: async () => {
        const result = await dialog.showSaveDialog(senderWindow, {
          defaultPath: path.join(
            app.getPath("downloads"),
            `${archiveName}.zip`
          ),
          filters: [{ name: "ZIP archive", extensions: ["zip"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });

        return result.canceled ? null : (result.filePath ?? null);
      },
      copyZip: (sourcePath, destinationPath) =>
        fs.promises.copyFile(sourcePath, destinationPath),
      cleanupTemporaryDirectory: async (temporaryDirectory) => {
        try {
          await fs.promises.rm(temporaryDirectory, {
            recursive: true,
            force: true,
          });
        } catch (error) {
          logger.error(
            "Failed to clean up legacy save export temporary files",
            error
          );
        }
      },
    });
  } catch (error) {
    if (signal.aborted) return { status: "cancelled" };

    logger.error("Failed to export legacy save", error);
    throw error;
  } finally {
    gameArtifactExportCoordinator.finish(abortController);
  }
};

const cancelGameArtifactExport = (event: Electron.IpcMainInvokeEvent) =>
  gameArtifactExportCoordinator.cancel(event.sender.id);

registerEvent("exportGameArtifact", exportGameArtifact);
registerEvent("cancelGameArtifactExport", cancelGameArtifactExport);
