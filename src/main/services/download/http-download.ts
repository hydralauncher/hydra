import { DownloadItem } from "electron";
import { WindowManager } from "../window-manager";

export class HTTPDownload {
  private static id = 0;

  private static downloads: Record<string, DownloadItem> = {};

  public static getStatus(gid: string): {
    completedLength: number;
    totalLength: number;
    downloadSpeed: number;
  } | null {
    const downloadItem = this.downloads[gid];
    if (downloadItem) {
      return {
        completedLength: downloadItem.getReceivedBytes(),
        totalLength: downloadItem.getTotalBytes(),
        downloadSpeed: 0,
      };
    }

    return null;
  }

  static async cancelDownload(gid: string) {
    const downloadItem: DownloadItem = this.downloads[gid];
    downloadItem?.cancel();
    this.downloads;
  }

  static async pauseDownload(gid: string) {
    const downloadItem = this.downloads[gid];
    downloadItem?.pause();
  }

  static async resumeDownload(gid: string) {
    const downloadItem = this.downloads[gid];
    downloadItem?.resume();
  }

  static async startDownload(
    downloadPath: string,
    downloadUrl: string,
    header: string[] = []
  ) {
    return new Promise<string>((resolve) => {
      WindowManager.mainWindow?.webContents.downloadURL(downloadUrl, {
        headers: { Cookie: header[0].split(": ")[1] },
      });

      WindowManager.mainWindow?.webContents.session.on(
        "will-download",
        (_event, item, _webContents) => {
          const gid = ++this.id;

          this.downloads[gid.toString()] = item;

          // Set the save path, making Electron not to prompt a save dialog.
          item.setSavePath(downloadPath);

          item.on("updated", (_event, state) => {
            if (state === "interrupted") {
              console.log("Download is interrupted but can be resumed");
            } else if (state === "progressing") {
              if (item.isPaused()) {
                console.log("Download is paused");
              } else {
                console.log(`Received bytes: ${item.getReceivedBytes()}`);
              }
            }
          });

          item.once("done", (_event, state) => {
            if (state === "completed") {
              console.log("Download successfully");
            } else {
              console.log(`Download failed: ${state}`);
            }
          });

          resolve(gid.toString());
        }
      );
    });
  }
}
