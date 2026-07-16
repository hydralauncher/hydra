import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import axios from "axios";
import { app } from "electron";
import { fileTypeFromBuffer } from "file-type";

import { registerEvent } from "../register-event";

const MAX_ARTWORK_SIZE_IN_BYTES = 1024 * 1024 * 20;
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

const downloadArtworkBuffer = async (
  artworkUrl: string,
  redirectCount = 0
): Promise<Buffer> => {
  const response = await axios.get<ArrayBuffer>(artworkUrl, {
    responseType: "arraybuffer",
    maxContentLength: MAX_ARTWORK_SIZE_IN_BYTES,
    maxBodyLength: MAX_ARTWORK_SIZE_IN_BYTES,
    maxRedirects: 0,
    timeout: 30_000,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  if (response.status >= 300) {
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

    return downloadArtworkBuffer(redirectUrl, redirectCount + 1);
  }

  return Buffer.from(response.data);
};

const downloadGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  artworkUrl: string
): Promise<string> => {
  if (!isSteamGridDbUrl(artworkUrl)) {
    throw new Error("Invalid SteamGridDB artwork URL");
  }

  const buffer = await downloadArtworkBuffer(artworkUrl);

  if (!buffer.length || buffer.length > MAX_ARTWORK_SIZE_IN_BYTES) {
    throw new Error("Invalid SteamGridDB artwork size");
  }

  const fileType = await fileTypeFromBuffer(buffer);
  const extension = fileType?.mime
    ? EXTENSION_BY_MIME[fileType.mime]
    : undefined;

  if (!extension) {
    throw new Error("Unsupported SteamGridDB artwork type");
  }

  const tempFilePath = path.join(
    app.getPath("temp"),
    `hydra-temp-${randomUUID()}-steamgriddb.${extension}`
  );

  await fs.promises.writeFile(tempFilePath, buffer);

  return tempFilePath;
};

registerEvent("downloadGameArtwork", downloadGameArtwork);
