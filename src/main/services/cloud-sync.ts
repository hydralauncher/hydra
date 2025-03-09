import { levelKeys, gamesSublevel, db } from "@main/level";
import { app } from "electron";
import path from "node:path";
import * as tar from "tar";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type { GameShop, User } from "@types";
import { backupsPath } from "@main/constants";
import { HydraApi } from "./hydra-api";
import { normalizePath } from "@main/helpers";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import axios from "axios";
import { Ludusavi } from "./ludusavi";
import { isFuture, isToday } from "date-fns";
import { SubscriptionRequiredError } from "@shared";

export class CloudSync {
  private static async bundleBackup(
    shop: GameShop,
    objectId: string,
    winePrefix: string | null
  ) {
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    // Remove existing backup
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true });
    }

    await Ludusavi.backupGame(shop, objectId, backupPath, winePrefix);

    const tarLocation = path.join(backupsPath, `${crypto.randomUUID()}.tar`);

    await tar.create(
      {
        gzip: false,
        file: tarLocation,
        cwd: backupPath,
      },
      ["."]
    );

    return tarLocation;
  }

  public static async uploadSaveGame(
    objectId: string,
    shop: GameShop,
    downloadOptionTitle: string | null,
    label?: string
  ) {
    const hasActiveSubscription = await db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .then((user) => {
        const expiresAt = user?.subscription?.expiresAt;
        return expiresAt && (isFuture(expiresAt) || isToday(expiresAt));
      });

    if (!hasActiveSubscription) {
      throw new SubscriptionRequiredError();
    }

    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

    const bundleLocation = await this.bundleBackup(
      shop,
      objectId,
      game?.winePrefixPath ?? null
    );

    fs.stat(bundleLocation, async (err, stat) => {
      if (err) {
        logger.error("Failed to get zip file stats", err);
        throw err;
      }

      const { uploadUrl } = await HydraApi.post<{
        id: string;
        uploadUrl: string;
      }>("/profile/games/artifacts", {
        artifactLengthInBytes: stat.size,
        shop,
        objectId,
        hostname: os.hostname(),
        homeDir: normalizePath(app.getPath("home")),
        downloadOptionTitle,
        platform: os.platform(),
        label,
      });

      fs.readFile(bundleLocation, async (err, fileBuffer) => {
        if (err) {
          logger.error("Failed to read zip file", err);
          throw err;
        }

        await axios.put(uploadUrl, fileBuffer, {
          headers: {
            "Content-Type": "application/tar",
          },
          onUploadProgress: (progressEvent) => {
            logger.log(progressEvent);
          },
        });

        WindowManager.mainWindow?.webContents.send(
          `on-upload-complete-${objectId}-${shop}`,
          true
        );

        fs.rm(bundleLocation, (err) => {
          if (err) {
            logger.error("Failed to remove tar file", err);
            throw err;
          }
        });
      });
    });
  }
}
