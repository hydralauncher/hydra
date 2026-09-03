import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import { fileTypeFromFile } from "file-type";

import type { ArtworkAssetType, ArtworkKind, GameShop } from "@types";

import { HydraApi } from "@main/services/hydra-api";
import { logger } from "./logger";

const MAX_ARTWORK_SIZE_IN_BYTES = 1024 * 1024 * 20;

const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

const ARTWORK_KIND_BY_ASSET_TYPE: Record<ArtworkAssetType, ArtworkKind> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const MIME_BY_EXTENSION: Record<AllowedImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const EXTENSION_BY_MIME: Record<string, AllowedImageExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SUBSCRIPTION_OPTIONS = {
  needsAuth: true,
  needsSubscription: true,
} as const;

const canSyncArtwork = () =>
  HydraApi.isLoggedIn() && HydraApi.hasActiveSubscription();

const resolveLocalPath = (localUrl: string) =>
  localUrl.startsWith("local:") ? localUrl.slice("local:".length) : null;

const resolveImageExtension = async (
  localPath: string
): Promise<AllowedImageExtension | null> => {
  const rawExtension = path.extname(localPath).slice(1).toLowerCase();
  if ((ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(rawExtension)) {
    return rawExtension as AllowedImageExtension;
  }

  const fileType = await fileTypeFromFile(localPath);
  return fileType?.mime ? (EXTENSION_BY_MIME[fileType.mime] ?? null) : null;
};

export const uploadCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  localUrl: string
): Promise<void> => {
  if (!canSyncArtwork()) return;

  try {
    const localPath = resolveLocalPath(localUrl);
    if (!localPath) return;

    const stats = await fs.promises.stat(localPath).catch(() => null);
    if (!stats) return;

    const imageLength = stats.size;
    if (imageLength <= 0 || imageLength > MAX_ARTWORK_SIZE_IN_BYTES) {
      logger.warn(
        `Skipping custom artwork upload for ${shop}/${objectId}: invalid size ${imageLength}`
      );
      return;
    }

    const imageExt = await resolveImageExtension(localPath);
    if (!imageExt) {
      logger.warn(
        `Skipping custom artwork upload for ${shop}/${objectId}: unsupported image type`
      );
      return;
    }

    const fileBuffer = await fs.promises.readFile(localPath);

    const kind = ARTWORK_KIND_BY_ASSET_TYPE[assetType];

    const { presignedUrl, imageUrl } = await HydraApi.post<{
      presignedUrl: string;
      imageUrl: string;
    }>(
      `/profile/games/${shop}/${objectId}/artwork/${kind}/upload-url`,
      { imageExt, imageLength },
      SUBSCRIPTION_OPTIONS
    );

    await axios.put(presignedUrl, fileBuffer, {
      headers: { "Content-Type": MIME_BY_EXTENSION[imageExt] },
    });

    await HydraApi.put(
      `/profile/games/${shop}/${objectId}/artwork/${kind}`,
      { source: "upload", url: imageUrl },
      SUBSCRIPTION_OPTIONS
    );
  } catch (error) {
    logger.error(
      `Failed to sync custom artwork upload for ${shop}/${objectId}:`,
      error
    );
  }
};

export const saveSteamGridDbArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  url: string
): Promise<void> => {
  if (!canSyncArtwork()) return;

  try {
    const kind = ARTWORK_KIND_BY_ASSET_TYPE[assetType];
    await HydraApi.put(
      `/profile/games/${shop}/${objectId}/artwork/${kind}`,
      { source: "steamgriddb", url },
      SUBSCRIPTION_OPTIONS
    );
  } catch (error) {
    logger.error(
      `Failed to sync SteamGridDB artwork for ${shop}/${objectId}:`,
      error
    );
  }
};

export const deleteCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType
): Promise<void> => {
  if (!canSyncArtwork()) return;

  try {
    const kind = ARTWORK_KIND_BY_ASSET_TYPE[assetType];
    await HydraApi.delete(
      `/profile/games/${shop}/${objectId}/artwork/${kind}`,
      SUBSCRIPTION_OPTIONS
    );
  } catch (error) {
    logger.error(
      `Failed to clear custom artwork for ${shop}/${objectId}:`,
      error
    );
  }
};
