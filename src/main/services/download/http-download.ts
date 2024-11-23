import { WindowManager } from "../window-manager";
import path from "node:path";

export class HttpDownload {
  private downloadItem: Electron.DownloadItem;

  constructor(
    private downloadPath: string,
    private downloadUrl: string,
    private headers?: Record<string, string>
  ) {}

  public getStatus() {
    return {
      completedLength: this.downloadItem.getReceivedBytes(),
      totalLength: this.downloadItem.getTotalBytes(),
      downloadSpeed: this.downloadItem.getCurrentBytesPerSecond(),
      folderName: this.downloadItem.getFilename(),
    };
  }

  async cancelDownload() {
    this.downloadItem.cancel();
  }

  async pauseDownload() {
    this.downloadItem.pause();
  }

  async resumeDownload() {
    this.downloadItem.resume();
  }

  async startDownload() {
    return new Promise((resolve) => {
      const options = this.headers ? { headers: this.headers } : {};
      WindowManager.mainWindow?.webContents.downloadURL(
        this.downloadUrl,
        options
      );

      WindowManager.mainWindow?.webContents.session.once(
        "will-download",
        (_event, item, _webContents) => {
          this.downloadItem = item;

          item.setSavePath(path.join(this.downloadPath, item.getFilename()));

          resolve(null);
        }
      );
    });
  }
}
