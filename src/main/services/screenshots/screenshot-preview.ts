import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SystemPath } from "../system-path";

export const getScreenshotPreviewsDirectory = () =>
  path.join(SystemPath.getPath("userData"), "screenshot-previews");

export const writeScreenshotPreview = async (preview: Buffer) => {
  const directory = getScreenshotPreviewsDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  const previewPath = path.join(directory, `${randomUUID()}.jpeg`);
  await fs.promises.writeFile(previewPath, preview);
  return previewPath;
};

export const removeScreenshotPreview = async (
  previewPath: string | null | undefined
) => {
  if (previewPath) await fs.promises.rm(previewPath, { force: true });
};
