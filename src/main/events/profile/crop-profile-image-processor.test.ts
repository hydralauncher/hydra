import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import sharp from "sharp";

import {
  CROP_IMAGE_LIMIT_INPUT_PIXELS,
  canSkipImageCrop,
  cropProfileImageToBuffer,
  isIdentityImageCrop,
} from "./crop-profile-image-processor.ts";

const tempDirectories: string[] = [];

const createTempDirectory = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-image-crop-")
  );
  tempDirectories.push(directory);
  return directory;
};

const createAnimatedWebp = async (filePath: string) => {
  const frames = await Promise.all(
    ["red", "green", "blue"].map((background) =>
      sharp({
        create: {
          width: 32,
          height: 20,
          channels: 4,
          background,
        },
      })
        .png()
        .toBuffer()
    )
  );

  await sharp(frames, { join: { animated: true } })
    .webp({ delay: [40, 50, 60], loop: 2 })
    .toFile(filePath);
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true })
      )
  );
});

describe("cropProfileImageToBuffer", () => {
  it("detects identity crops", () => {
    assert.equal(
      isIdentityImageCrop(1920, 620, {
        left: 0.1,
        top: -0.1,
        width: 1919.9,
        height: 620.1,
        outputWidth: 1920,
        outputHeight: 620,
        rotation: 0,
      }),
      true
    );

    assert.equal(
      isIdentityImageCrop(1920, 620, {
        left: 0,
        top: 0,
        width: 1920,
        height: 620,
        outputWidth: 1920,
        outputHeight: 620,
        rotation: 90,
      }),
      false
    );

    assert.equal(
      isIdentityImageCrop(3840, 1240, {
        left: 0,
        top: 0,
        width: 3840,
        height: 1240,
        outputWidth: 1920,
        outputHeight: 620,
      }),
      false
    );
  });

  it("skips unchanged matching images even if UI crop state is stale", () => {
    assert.equal(
      canSkipImageCrop(1920, 620, {
        left: 719,
        top: 285,
        width: 480,
        height: 154,
        outputWidth: 1920,
        outputHeight: 620,
        rotation: 0,
        skipProcessingIfUnchanged: true,
      }),
      true
    );

    assert.equal(
      canSkipImageCrop(3840, 1240, {
        left: 0,
        top: 0,
        width: 3840,
        height: 1240,
        outputWidth: 1920,
        outputHeight: 620,
        skipProcessingIfUnchanged: true,
      }),
      false
    );
  });

  it("crops static images", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "static.png");

    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 4,
        background: "red",
      },
    })
      .png()
      .toFile(sourcePath);

    const result = await cropProfileImageToBuffer(sourcePath, {
      left: 5,
      top: 5,
      width: 20,
      height: 10,
      outputWidth: 100,
      outputHeight: 50,
    });
    const metadata = await sharp(result).metadata();

    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 50);
    assert.equal(metadata.pages, undefined);
  });

  it("preserves animation metadata", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "animated.webp");
    await createAnimatedWebp(sourcePath);

    const result = await cropProfileImageToBuffer(sourcePath, {
      left: 0,
      top: 0,
      width: 32,
      height: 20,
      outputWidth: 64,
      outputHeight: 40,
    });
    const metadata = await sharp(result, { animated: true }).metadata();

    assert.equal(metadata.width, 64);
    assert.equal(metadata.pageHeight, 40);
    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, [40, 50, 60]);
    assert.equal(metadata.loop, 2);
  });

  it("preserves animation when rotating", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "animated.webp");
    await createAnimatedWebp(sourcePath);

    const result = await cropProfileImageToBuffer(sourcePath, {
      left: 0,
      top: 0,
      width: 20,
      height: 32,
      outputWidth: 40,
      outputHeight: 64,
      rotation: 90,
    });
    const metadata = await sharp(result, { animated: true }).metadata();

    assert.equal(metadata.width, 40);
    assert.equal(metadata.pageHeight, 64);
    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, [40, 50, 60]);
    assert.equal(metadata.loop, 2);
  });

  it("rejects images above the crop pixel limit", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "oversized.svg");
    const dimension = Math.floor(Math.sqrt(CROP_IMAGE_LIMIT_INPUT_PIXELS) + 1);

    await fs.promises.writeFile(
      sourcePath,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}"></svg>`
    );

    await assert.rejects(
      cropProfileImageToBuffer(sourcePath, {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        outputWidth: 1,
        outputHeight: 1,
      }),
      /Input image exceeds pixel limit/
    );
  });
});
