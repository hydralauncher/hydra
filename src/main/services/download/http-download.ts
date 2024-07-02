import type { ChildProcess } from "node:child_process";
import { logger } from "../logger";
import { sleep } from "@main/helpers";
import { startAria2 } from "../aria2c";
import Aria2 from "aria2";

export class HttpDownload {
  private static connected = false;
  private static aria2c: ChildProcess | null = null;

  private static aria2 = new Aria2({});

  private static async connect() {
    this.aria2c = startAria2();

    let retries = 0;

    while (retries < 4 && !this.connected) {
      try {
        await this.aria2.open();
        logger.log("Connected to aria2");

        this.connected = true;
      } catch (err) {
        await sleep(100);
        logger.log("Failed to connect to aria2, retrying...");
        retries++;
      }
    }
  }

  public static getStatus(gid: string) {
    if (this.connected) {
      return this.aria2.call("tellStatus", gid);
    }

    return null;
  }

  public static disconnect() {
    if (this.aria2c) {
      this.aria2c.kill();
      this.connected = false;
    }
  }

  static async cancelDownload(gid: string) {
    await this.aria2.call("forceRemove", gid);
  }

  static async pauseDownload(gid: string) {
    await this.aria2.call("forcePause", gid);
  }

  static async resumeDownload(gid: string) {
    await this.aria2.call("unpause", gid);
  }

  static async startDownload(downloadPath: string, downloadUrl: string) {
    if (!this.connected) await this.connect();

    const options = {
      dir: downloadPath,
    };

    return this.aria2.call("addUri", [downloadUrl], options);
  }
}
