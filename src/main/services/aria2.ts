/// <reference path="./aria2.d.ts" />
import Aria2, { GUID } from "aria2";
import { app } from "electron";
import cp from "node:child_process";
import path from "node:path";

export class Aria2Service {
  private static aria2cProcess: cp.ChildProcessWithoutNullStreams | null = null;
  private static aria2: Aria2 | null = null;

  private static generateSecret() {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  private static startAria2cProcess(secret: string) {
    const aria2cPath = app.isPackaged
      ? path.join(process.resourcesPath, "aria2c.exe")
      : path.join(__dirname, "..", "..", "aria2c.exe");

    this.aria2cProcess = cp.spawn(aria2cPath, [
      "--enable-rpc",
      "--rpc-listen-all=true",
      "--rpc-allow-origin-all",
      "--file-allocation=none",
      "--rpc-secret",
      secret,
    ]);
  }

  static async startService() {
    const secret = this.generateSecret();

    this.startAria2cProcess(secret);

    this.aria2 = new Aria2([
      {
        host: "localhost",
        port: 6800,
        secure: false,
        path: "/jsonrpc",
      },
    ]);

    // Hack: aria2 secret doesn't work if pasted in the options above
    this.aria2.secret = secret;

    await this.aria2.open();
  }

  static async addHttpDownload(url: string, destiny: string) {
    console.log("Adding download", url, destiny);
    const guid = await this.aria2!.call("addUri", [url], { dir: destiny });
    return new Aria2Download(guid, this.aria2!);
  }
}

Aria2Service.startService();

export class Aria2Download {
  private interval: NodeJS.Timeout;

  /**
   * Do not construct this class directly. Use Aria2Service.addHttpDownload instead.
   * @param id
   */
  constructor(
    private id: GUID,
    private aria2: Aria2,
    pollInterval = 1000
  ) {
    this.interval = setInterval(this.poll.bind(this), pollInterval);

    this.aria2.on("onDownloadPause", this.stopPoll.bind(this));
    this.aria2.on("onDownloadResume", this.startPoll.bind(this));
    this.aria2.on("onDownloadCancel", this.stopPoll.bind(this));
    this.aria2.on("onDownloadComplete", this.stopPoll.bind(this));
  }

  private async startPoll() {
    this.interval = setInterval(this.poll.bind(this), 1000);
  }

  private async stopPoll() {
    clearInterval(this.interval);
  }

  private async poll() {
    this.aria2.emit("onPoll", await this.status());
  }

  async status() {
    const status = await this.aria2.call("tellStatus", this.id);

    return {
      progress: parseInt(status.completedLength) / parseInt(status.totalLength),
      size: parseInt(status.totalLength),
      downloadSpeed: parseInt(status.downloadSpeed),
      timeRemaining:
        (parseInt(status.totalLength) - parseInt(status.completedLength)) /
        parseInt(status.downloadSpeed),
      status: status.status,
      folderName: status.dir,
      filePath: status.files[0].path,
      fileSize: parseInt(status.totalLength),
      bytesDownloaded: parseInt(status.completedLength),
    };
  }

  async pause() {
    this.stopPoll();
    await this.aria2.call("pause", this.id);
  }

  async resume() {
    await this.aria2.call("unpause", this.id);
  }

  async cancel() {
    this.stopPoll();
    await this.aria2.call("remove", this.id);
  }

  on(event: "onPoll", listener: (payload: Aria2DownloadStatus) => void);
  on(event: "onDownloadPause", listener: () => void);
  on(event: "onDownloadResume", listener: () => void);
  on(event: "onDownloadCancel", listener: () => void);
  on(event: "onDownloadComplete", listener: () => void);
  on(event: string, listener: (...args: any[]) => void) {
    this.aria2.on(event, listener);
  }
}

export type Aria2DownloadStatus = Awaited<ReturnType<Aria2Download["status"]>>;
