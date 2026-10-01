import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { StreamCoverCache, sniffImageExt } from "./cover-cache.ts";

const ONE_BY_ONE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

describe("sniffImageExt", () => {
  it("detects png, jpeg and webp magic bytes", () => {
    assert.equal(sniffImageExt(ONE_BY_ONE_PNG), "png");
    assert.equal(
      sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
      "jpeg"
    );
    assert.equal(
      sniffImageExt(
        Buffer.concat([
          Buffer.from("RIFF....", "ascii"),
          Buffer.from("WEBP", "ascii"),
        ])
      ),
      "webp"
    );
  });

  it("rejects HTML and empty bodies", () => {
    assert.equal(
      sniffImageExt(Buffer.from("<html><body>404</body></html>")),
      null
    );
    assert.equal(sniffImageExt(Buffer.alloc(0)), null);
    assert.equal(sniffImageExt(Buffer.from("RIFF....WAVE")), null);
  });
});

describe("StreamCoverCache", () => {
  let server: http.Server;
  let baseUrl: string;
  let requests: string[];
  let dir: string;

  const serve = async (
    handler: (url: string) => { body: Buffer; type?: string }
  ) => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.url ?? "");
      const { body, type } = handler(req.url ?? "");
      res.writeHead(200, {
        "Content-Type": type ?? "application/octet-stream",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        assert(typeof address === "object" && address !== null);
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-stream-covers-"));
  });

  after(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("downloads a remote cover, caches it with a url sidecar and reuses it", async () => {
    await serve(() => ({ body: ONE_BY_ONE_PNG, type: "image/jpeg" }));
    const cache = new StreamCoverCache(dir);

    const first = await cache.resolve(7, `${baseUrl}/cover.jpg`);
    assert.ok(first);
    assert.ok(
      first.endsWith(`${path.sep}7.png`),
      "extension follows magic bytes"
    );
    assert.deepEqual(fs.readFileSync(first), ONE_BY_ONE_PNG);
    assert.equal(
      fs.readFileSync(`${first}.url`, "utf-8"),
      `${baseUrl}/cover.jpg`
    );

    const second = await cache.resolve(7, `${baseUrl}/cover.jpg`);
    assert.equal(second, first);
    assert.equal(requests.length, 1, "unchanged URL must not re-download");
  });

  it("re-downloads when the source URL changes and removes stale files", async () => {
    await serve(() => ({ body: ONE_BY_ONE_PNG }));
    const cache = new StreamCoverCache(dir);

    const before = await cache.resolve(9, `${baseUrl}/old.jpg`);
    assert.ok(before);

    const after = await cache.resolve(9, `${baseUrl}/new.jpg`);
    assert.ok(after);
    assert.equal(requests.length, 2);
    assert.equal(
      fs.readFileSync(`${after}.url`, "utf-8"),
      `${baseUrl}/new.jpg`
    );
    assert.equal(
      fs.readdirSync(dir).filter((entry) => entry.startsWith("9.")).length,
      2,
      "one image file plus one sidecar"
    );
  });

  it("discards non-image responses without leaving files behind", async () => {
    await serve(() => ({
      body: Buffer.from("<html>not found</html>"),
      type: "text/html",
    }));
    const cache = new StreamCoverCache(dir);

    assert.equal(await cache.resolve(11, `${baseUrl}/missing.jpg`), null);
    assert.equal(
      fs.readdirSync(dir).filter((entry) => entry.startsWith("11.")).length,
      0
    );
  });

  it("tolerates network errors", async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    const cache = new StreamCoverCache(dir);
    assert.equal(await cache.resolve(13, "http://127.0.0.1:1/down.jpg"), null);
  });

  it("resolveAll resolves many covers", async () => {
    await serve(() => ({ body: ONE_BY_ONE_PNG }));
    const cache = new StreamCoverCache(path.join(dir, "bulk"));
    const requestsList = Array.from({ length: 8 }, (_, index) => ({
      appid: 100 + index,
      url: `${baseUrl}/cover-${index}.jpg`,
    }));
    const resolved = await cache.resolveAll(requestsList);
    assert.equal(resolved.size, 8);
    assert.equal(new Set(resolved.values()).size, 8);
  });
});
