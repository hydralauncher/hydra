import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { convertSteamShortcutAsset } from "./steam-shortcut-assets.ts";

const createWebp = () =>
  sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  })
    .webp()
    .toBuffer();

describe("Steam shortcut asset conversion", () => {
  it("converts WebP bytes to the requested JPEG and PNG formats", async () => {
    const source = await createWebp();
    const jpeg = await convertSteamShortcutAsset(source, "jpeg");
    const png = await convertSteamShortcutAsset(source, "png");

    assert.equal((await fileTypeFromBuffer(jpeg))?.ext, "jpg");
    assert.equal((await fileTypeFromBuffer(png))?.ext, "png");
  });

  it("creates a real ICO file for shortcut icons", async () => {
    const ico = await convertSteamShortcutAsset(await createWebp(), "ico");

    assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  });
});
