import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import sharp from "sharp";

import { createAnimatedPng } from "../profile/apng-test-utils.ts";
import {
  MAX_CUSTOM_ARTWORK_SIZE_IN_BYTES,
  cropGameAssetToPath,
  type PrepareAnimatedPngCrop,
} from "./crop-game-asset-processor.ts";

const tempDirectories: string[] = [];

const createTempDirectory = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-game-asset-crop-")
  );
  tempDirectories.push(directory);
  return directory;
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

describe("cropGameAssetToPath", () => {
  it("copies unchanged supported files with normalized extension", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "cover.jfif");
    await sharp({
      create: { width: 20, height: 30, channels: 3, background: "red" },
    })
      .jpeg()
      .toFile(sourcePath);

    const result = await cropGameAssetToPath(
      sourcePath,
      path.join(directory, "result"),
      {
        left: 0,
        top: 0,
        width: 20,
        height: 30,
        outputWidth: 20,
        outputHeight: 30,
        skipProcessingIfUnchanged: true,
      }
    );

    assert.equal(result.wasProcessed, false);
    assert.equal(path.extname(result.imagePath), ".jpg");
    assert.equal(result.byteLength, (await fs.promises.stat(sourcePath)).size);
  });

  it("processes edited static images as WebP", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "cover.png");
    await sharp({
      create: { width: 40, height: 30, channels: 4, background: "blue" },
    })
      .png()
      .toFile(sourcePath);

    const result = await cropGameAssetToPath(
      sourcePath,
      path.join(directory, "result"),
      {
        left: 5,
        top: 5,
        width: 20,
        height: 10,
        outputWidth: 100,
        outputHeight: 50,
      }
    );
    const metadata = await sharp(result.imagePath).metadata();

    assert.equal(result.wasProcessed, true);
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 50);
  });

  it("processes unchanged files above the cloud limit", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "large.jpg");
    await sharp({
      create: { width: 20, height: 30, channels: 3, background: "red" },
    })
      .jpeg()
      .toFile(sourcePath);
    await fs.promises.truncate(
      sourcePath,
      MAX_CUSTOM_ARTWORK_SIZE_IN_BYTES + 1
    );

    const result = await cropGameAssetToPath(
      sourcePath,
      path.join(directory, "result"),
      {
        left: 0,
        top: 0,
        width: 20,
        height: 30,
        outputWidth: 20,
        outputHeight: 30,
        skipProcessingIfUnchanged: true,
      }
    );

    assert.equal(result.wasProcessed, true);
    assert.equal(path.extname(result.imagePath), ".webp");
  });

  it("preserves APNG frames, delays, loop and cleans temporary frames", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "animated.png");
    await createAnimatedPng(sourcePath);

    let temporaryFramePaths: string[] = [];
    const prepare: PrepareAnimatedPngCrop = async (_imagePath, params) => {
      temporaryFramePaths = await Promise.all(
        ["red", "green", "blue"].map(async (background, index) => {
          const framePath = path.join(directory, `frame-${index}.png`);
          await sharp({
            create: {
              width: params.outputWidth,
              height: params.outputHeight,
              channels: 4,
              background,
            },
          })
            .png()
            .toFile(framePath);
          return framePath;
        })
      );
      return {
        framePaths: temporaryFramePaths,
        delays: [40, 50, 60],
        loopCount: 2,
      };
    };

    const result = await cropGameAssetToPath(
      sourcePath,
      path.join(directory, "result"),
      {
        left: 0,
        top: 0,
        width: 20,
        height: 32,
        outputWidth: 40,
        outputHeight: 64,
        rotation: 90,
      },
      prepare
    );
    const metadata = await sharp(result.imagePath, {
      animated: true,
    }).metadata();

    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, [40, 50, 60]);
    assert.equal(metadata.loop, 2);
    assert.equal(metadata.width, 40);
    assert.equal(metadata.pageHeight, 64);
    assert.ok(
      temporaryFramePaths.every((framePath) => !fs.existsSync(framePath))
    );
  });
});
