import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

import axios, { type AxiosProgressEvent } from "axios";
import { app } from "electron";
import { logger } from "../logger";

export class HttpDownload {
  private abortController: AbortController;
  public lastProgressEvent: AxiosProgressEvent;
  private trackerFilePath: string;

  private trackerProgressEvent: AxiosProgressEvent | null = null;
  private downloadPath: string;

  private downloadTrackersPath = path.join(
    app.getPath("documents"),
    "Hydra",
    "Downloads"
  );

  constructor(
    private url: string,
    private savePath: string
  ) {
    this.abortController = new AbortController();

    const sha256Hasher = crypto.createHash("sha256");
    const hash = sha256Hasher.update(url).digest("hex");

    this.trackerFilePath = path.join(
      this.downloadTrackersPath,
      `${hash}.hydradownload`
    );

    const filename = path.win32.basename(this.url);
    this.downloadPath = path.join(this.savePath, filename);
  }

  private updateTrackerFile() {
    if (!fs.existsSync(this.downloadTrackersPath)) {
      fs.mkdirSync(this.downloadTrackersPath, {
        recursive: true,
      });
    }

    fs.writeFileSync(
      this.trackerFilePath,
      JSON.stringify(this.lastProgressEvent),
      { encoding: "utf-8" }
    );
  }

  private removeTrackerFile() {
    if (fs.existsSync(this.trackerFilePath)) {
      fs.rm(this.trackerFilePath, () => {});
    }
  }

  public async startDownload() {
    // Check if there's already a tracker file and download file
    if (
      fs.existsSync(this.trackerFilePath) &&
      fs.existsSync(this.downloadPath)
    ) {
      this.trackerProgressEvent = JSON.parse(
        fs.readFileSync(this.trackerFilePath, { encoding: "utf-8" })
      );
    }

    const response = await axios.get(this.url, {
      responseType: "stream",
      signal: this.abortController.signal,
      headers: {
        Range: `bytes=${this.trackerProgressEvent?.loaded ?? 0}-`,
      },
      onDownloadProgress: (progressEvent) => {
        const total =
          this.trackerProgressEvent?.total ?? progressEvent.total ?? 0;
        const loaded =
          (this.trackerProgressEvent?.loaded ?? 0) + progressEvent.loaded;

        const progress = loaded / total;

        this.lastProgressEvent = {
          ...progressEvent,
          total,
          progress,
          loaded,
        };
        this.updateTrackerFile();

        if (progressEvent.progress === 1) {
          this.removeTrackerFile();
        }
      },
    });

    response.data.pipe(
      fs.createWriteStream(this.downloadPath, {
        flags: "a",
      })
    );
  }

  public async pauseDownload() {
    this.abortController.abort();
  }

  public cancelDownload() {
    this.pauseDownload();

    fs.rm(this.downloadPath, (err) => {
      if (err) logger.error(err);
    });
    fs.rm(this.trackerFilePath, (err) => {
      if (err) logger.error(err);
    });
  }
}
