import { levelKeys, gamesSublevel, db } from "@main/level";
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
import { formatDate, SubscriptionRequiredError } from "@shared";
import i18next, { t } from "i18next";
import { SystemPath } from "./system-path";

export class CloudSync {
  public static getBackupLabel(automatic: boolean) {
    const language = i18next.language;

    const date = formatDate(new Date(), language);

    if (automatic) {
      return t("automatic_backup_from", {
        ns: "game_details",
        date,
      });
    }

    return t("backup_from", {
      ns: "game_details",
      date,
    });
  }

  private static async bundleBackup(
    shop: GameShop,
    objectId: string,
    winePrefix: string | null
  ) {
    const backupPath = path.join(backupsPath, `${shop}-${objectId}`);

    // Remove existing backup
    if (fs.existsSync(backupPath)) {
      try {
        await fs.promises.rm(backupPath, { recursive: true });
      } catch (error) {
        logger.error("Failed to remove backup path", error);
      }
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
        const expiresAt = new Date(user?.subscription?.expiresAt ?? 0);
        return expiresAt > new Date();
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

    const stat = await fs.promises.stat(bundleLocation);

    const { uploadUrl } = await HydraApi.post<{
      id: string;
      uploadUrl: string;
    }>("/profile/games/artifacts", {
      artifactLengthInBytes: stat.size,
      shop,
      objectId,
      hostname: os.hostname(),
      homeDir: normalizePath(SystemPath.getPath("home")),
      downloadOptionTitle,
      platform: os.platform(),
      label,
    });

    const fileBuffer = await fs.promises.readFile(bundleLocation);

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

    try {
      await fs.promises.unlink(bundleLocation);
    } catch (error) {
      logger.error("Failed to remove tar file", error);
    }
  }
}
