import { registerEvent } from "./register-event";
import { CloudStorageService, WindowManager, logger } from "@main/services";

// Note: restoring a cloud backup reuses the existing "restoreYandexDiskBackup"
// channel (see ./yandex-disk.ts) — it already resolves the game from the
// local library and calls YandexDiskBackup.downloadAndRestoreBackup, so
// there is no need for a separate handler here.

const listCloudBackups = async (_event: Electron.IpcMainInvokeEvent) => {
  return CloudStorageService.listBackups();
};

const getCloudStorageUsage = async (_event: Electron.IpcMainInvokeEvent) => {
  return CloudStorageService.getStorageUsage();
};

const downloadCloudBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  remotePath: string,
  destDir: string
) => {
  try {
    await CloudStorageService.ensureDownloadDirExists(destDir);

    const localPath = await CloudStorageService.downloadBackup(
      remotePath,
      destDir,
      (percent) => {
        WindowManager.sendToAppWindows("on-cloud-backup-download-progress", {
          path: remotePath,
          percent,
        });
      }
    );

    WindowManager.sendToAppWindows("on-cloud-backup-download-complete", {
      path: remotePath,
      success: true,
      localPath,
    });

    return { success: true, localPath };
  } catch (err) {
    logger.error("[CloudStorage] downloadCloudBackup error", err);

    WindowManager.sendToAppWindows("on-cloud-backup-download-complete", {
      path: remotePath,
      success: false,
    });

    throw err;
  }
};

const deleteCloudBackup = async (
  _event: Electron.IpcMainInvokeEvent,
  remotePath: string
) => {
  await CloudStorageService.deleteBackup(remotePath);
  return { success: true };
};

registerEvent("listCloudBackups", listCloudBackups);
registerEvent("getCloudStorageUsage", getCloudStorageUsage);
registerEvent("downloadCloudBackup", downloadCloudBackup);
registerEvent("deleteCloudBackup", deleteCloudBackup);
