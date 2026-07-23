import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import {
  buildDownloadFileName,
  transcodeNotificationIcon,
} from "./notification-icon.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const WINDOWS_ILLEGAL_CHARACTERS = /[<>:"/\\|?*]/;

let workingDirectory: string;

const createSolidImage = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  });

before(() => {
  workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "hydra-notification-icon-test-")
  );
});

after(() => {
  fs.rmSync(workingDirectory, { recursive: true, force: true });
});

describe("buildDownloadFileName", () => {
  it("produces a name free of characters that are illegal on Windows", () => {
    const fileName = buildDownloadFileName(
      "https://cdn.hydra/profile-images/avatar.webp?v=2&token=a/b"
    );

    assert.ok(!WINDOWS_ILLEGAL_CHARACTERS.test(fileName));
  });

  it("keeps the source extension", () => {
    assert.ok(
      buildDownloadFileName("https://cdn.hydra/x/avatar.webp").endsWith(".webp")
    );
  });

  it("drops the query string from the extension", () => {
    assert.ok(
      buildDownloadFileName("https://cdn.hydra/x/avatar.webp?v=2").endsWith(
        ".webp"
      )
    );
  });

  it("gives different urls different names", () => {
    assert.notEqual(
      buildDownloadFileName("https://cdn.hydra/a/avatar.webp"),
      buildDownloadFileName("https://cdn.hydra/b/avatar.webp")
    );
  });

  it("handles urls with no basename", () => {
    const fileName = buildDownloadFileName("https://cdn.hydra/");

    assert.ok(fileName.length > 0);
    assert.ok(!WINDOWS_ILLEGAL_CHARACTERS.test(fileName));
  });

  it("handles urls that cannot be parsed", () => {
    const fileName = buildDownloadFileName("not a url at all");

    assert.ok(fileName.length > 0);
    assert.ok(!WINDOWS_ILLEGAL_CHARACTERS.test(fileName));
  });
});

describe("transcodeNotificationIcon", () => {
  it("transcodes a static webp into a png nativeImage can decode", async () => {
    const source = path.join(workingDirectory, "avatar.webp");
    await createSolidImage(512, 512).webp().toFile(source);

    const outputPath = await transcodeNotificationIcon(
      source,
      workingDirectory
    );

    assert.ok(outputPath.endsWith(".png"));
    assert.ok(
      fs.readFileSync(outputPath).subarray(0, 4).equals(PNG_SIGNATURE),
      "output should carry the PNG magic bytes"
    );
  });

  it("flattens an animated gif to a single frame", async () => {
    const source = path.join(workingDirectory, "avatar.gif");
    const frame = await createSolidImage(64, 64).png().toBuffer();
    await sharp([frame, frame], { join: { animated: true } })
      .gif()
      .toFile(source);

    const outputPath = await transcodeNotificationIcon(
      source,
      workingDirectory
    );
    const metadata = await sharp(outputPath).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.pages ?? 1, 1);
  });

  it("resizes to the notification icon size", async () => {
    const source = path.join(workingDirectory, "wide.png");
    await createSolidImage(1024, 256).png().toFile(source);

    const outputPath = await transcodeNotificationIcon(
      source,
      workingDirectory
    );
    const metadata = await sharp(outputPath).metadata();

    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
  });

  it("rejects for a file that is not an image", async () => {
    const source = path.join(workingDirectory, "corrupt.webp");
    fs.writeFileSync(source, "definitely not an image");

    await assert.rejects(() =>
      transcodeNotificationIcon(source, workingDirectory)
    );
  });
});
