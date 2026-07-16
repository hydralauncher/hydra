import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it } from "node:test";

import {
  MAX_ARTWORK_SIZE_IN_BYTES,
  parseContentLength,
  validateArtworkContentLength,
  writeArtworkStream,
} from "./download-game-artwork-stream.ts";

const tempDirectories: string[] = [];

const createTempPath = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-artwork-download-")
  );
  tempDirectories.push(directory);

  return path.join(directory, "artwork.download");
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

describe("SteamGridDB artwork stream", () => {
  it("parses and validates the Content-Length header", () => {
    assert.equal(parseContentLength("42"), 42);
    assert.equal(parseContentLength(undefined), null);
    assert.doesNotThrow(() =>
      validateArtworkContentLength(String(MAX_ARTWORK_SIZE_IN_BYTES))
    );
    assert.throws(
      () => validateArtworkContentLength(String(MAX_ARTWORK_SIZE_IN_BYTES + 1)),
      /Invalid SteamGridDB artwork size/
    );
  });

  it("writes a stream within the configured limit", async () => {
    const destinationPath = await createTempPath();

    await writeArtworkStream(
      Readable.from([Buffer.alloc(6), Buffer.alloc(4)]),
      destinationPath,
      10
    );

    assert.equal((await fs.promises.stat(destinationPath)).size, 10);
  });

  it("removes the partial file when the streamed limit is exceeded", async () => {
    const destinationPath = await createTempPath();

    await assert.rejects(
      writeArtworkStream(
        Readable.from([Buffer.alloc(6), Buffer.alloc(5)]),
        destinationPath,
        10
      ),
      /Invalid SteamGridDB artwork size/
    );

    assert.equal(fs.existsSync(destinationPath), false);
  });

  it("removes the partial file when the source stream fails", async () => {
    const destinationPath = await createTempPath();
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(5));
        this.destroy(new Error("Download interrupted"));
      },
    });

    await assert.rejects(
      writeArtworkStream(source, destinationPath, 10),
      /Download interrupted/
    );

    assert.equal(fs.existsSync(destinationPath), false);
  });
});
