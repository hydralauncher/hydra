import path from "node:path";
import fs from "node:fs";
import { SystemPath } from "./system-path";
import { logger } from "./logger";

export class Lock {
  private static lockFilePath = path.join(
    SystemPath.getPath("temp"),
    "hydra-launcher.lock"
  );

  public static async acquireLock() {
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(this.lockFilePath, "", (err) => {
        if (err) {
          logger.error("Error acquiring the lock", err);
          reject(err);
        }

        logger.info("Acquired the lock");
        resolve();
      });
    });
  }

  public static async releaseLock() {
    return new Promise<void>((resolve, reject) => {
      fs.unlink(this.lockFilePath, (err) => {
        if (err) {
          logger.error("Error releasing the lock", err);
          reject(err);
        }

        logger.info("Released the lock");
        resolve();
      });
    });
  }
}
