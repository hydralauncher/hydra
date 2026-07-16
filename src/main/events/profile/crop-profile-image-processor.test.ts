import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import sharp from "sharp";

import { createAnimatedPng } from "./apng-test-utils.ts";
import { cropProfileImageToBuffer } from "./crop-profile-image-processor.ts";

const tempDirectories: string[] = [];

const createTempDirectory = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-profile-crop-")
  );
  tempDirectories.push(directory);
  return directory;
};

const createAnimatedWebp = async (filePath: string) => {
  const frames = await Promise.all(
    ["red", "green", "blue"].map((background) =>
      sharp({
        create: { width: 32, height: 20, channels: 4, background },
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
  it("crops static images to WebP", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "static.png");
    await sharp({
      create: { width: 40, height: 30, channels: 4, background: "red" },
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
    const metadata = await sharp(result, { animated: true }).metadata();

    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 50);
    assert.equal(metadata.pages, undefined);
  });

  it("keeps GIF/WebP animation metadata", async () => {
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

    assert.equal(metadata.pages, 3);
    assert.deepEqual(metadata.delay, [40, 50, 60]);
    assert.equal(metadata.loop, 2);
  });

  it("flattens APNG profile images", async () => {
    const directory = await createTempDirectory();
    const sourcePath = path.join(directory, "animated.png");
    await createAnimatedPng(sourcePath);

    const result = await cropProfileImageToBuffer(sourcePath, {
      left: 0,
      top: 0,
      width: 32,
      height: 20,
      outputWidth: 64,
      outputHeight: 40,
    });
    const metadata = await sharp(result, { animated: true }).metadata();

    assert.equal(metadata.format, "webp");
    assert.equal(metadata.pages, undefined);
    assert.equal(metadata.width, 64);
    assert.equal(metadata.height, 40);
  });
});
