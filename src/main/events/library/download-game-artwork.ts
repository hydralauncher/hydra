import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import axios from "axios";
import { app } from "electron";
import { fileTypeFromFile } from "file-type";

import { registerEvent } from "../register-event";
import {
  MAX_ARTWORK_SIZE_IN_BYTES,
  validateArtworkContentLength,
  writeArtworkStream,
} from "./download-game-artwork-stream";

const MAX_REDIRECTS = 3;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/apng": "apng",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const isSteamGridDbUrl = (value: string) => {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      (url.hostname === "steamgriddb.com" ||
        url.hostname.endsWith(".steamgriddb.com"))
    );
  } catch {
    return false;
  }
};

const downloadArtworkStream = async (
  artworkUrl: string,
  redirectCount = 0
): Promise<Readable> => {
  const response = await axios.get<Readable>(artworkUrl, {
    responseType: "stream",
    maxRedirects: 0,
    timeout: 30_000,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  if (response.status >= 300) {
    response.data.destroy();

    if (redirectCount >= MAX_REDIRECTS || !response.headers.location) {
      throw new Error("Invalid SteamGridDB artwork redirect");
    }

    const redirectUrl = new URL(
      response.headers.location,
      artworkUrl
    ).toString();

    if (!isSteamGridDbUrl(redirectUrl)) {
      throw new Error("Untrusted SteamGridDB artwork redirect");
    }

    return downloadArtworkStream(redirectUrl, redirectCount + 1);
  }

  try {
    validateArtworkContentLength(response.headers["content-length"]);
  } catch (error) {
    response.data.destroy();
    throw error;
  }

  return response.data;
};

const downloadGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  artworkUrl: string
): Promise<string> => {
  if (!isSteamGridDbUrl(artworkUrl)) {
    throw new Error("Invalid SteamGridDB artwork URL");
  }

  const tempDirectory = app.getPath("temp");
  const tempFileBase = `hydra-temp-${randomUUID()}-steamgriddb`;
  const partialFilePath = path.join(tempDirectory, `${tempFileBase}.download`);
  let finalFilePath: string | null = null;

  try {
    const artworkStream = await downloadArtworkStream(artworkUrl);
    await writeArtworkStream(
      artworkStream,
      partialFilePath,
      MAX_ARTWORK_SIZE_IN_BYTES
    );

    const fileType = await fileTypeFromFile(partialFilePath);
    const extension = fileType?.mime
      ? EXTENSION_BY_MIME[fileType.mime]
      : undefined;

    if (!extension) {
      throw new Error("Unsupported SteamGridDB artwork type");
    }

    finalFilePath = path.join(tempDirectory, `${tempFileBase}.${extension}`);
    await fs.promises.rename(partialFilePath, finalFilePath);

    return finalFilePath;
  } catch (error) {
    await Promise.all([
      fs.promises.unlink(partialFilePath).catch(() => {}),
      finalFilePath
        ? fs.promises.unlink(finalFilePath).catch(() => {})
        : Promise.resolve(),
    ]);
    throw error;
  }
};

registerEvent("downloadGameArtwork", downloadGameArtwork);
