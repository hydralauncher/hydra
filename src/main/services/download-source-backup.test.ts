import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DOWNLOAD_SOURCE_BACKUP_BYTES,
  MAX_DOWNLOAD_SOURCE_BACKUP_ENTRIES,
  importDownloadSourceUrls,
  parseDownloadSourceBackup,
  serializeDownloadSources,
} from "./download-source-backup.ts";

const firstUrl = "https://example.com/first.json";
const secondUrl = "https://example.com/second.json";

describe("download source backups", () => {
  it("round trips all URLs without exporting local or account metadata", () => {
    const sources = [
      { url: firstUrl, id: "local-id", name: "First", fingerprint: "private" },
      { url: secondUrl, id: "other-id", createdAt: "2026-01-01" },
    ];
    const contents = serializeDownloadSources(sources);
    assert.deepEqual(JSON.parse(contents), {
      version: 1,
      sources: [{ url: firstUrl }, { url: secondUrl }],
    });
    assert.deepEqual(parseDownloadSourceBackup(contents), [
      firstUrl,
      secondUrl,
    ]);
  });

  it("accepts a UTF-8 BOM and trims URL whitespace", () => {
    assert.deepEqual(
      parseDownloadSourceBackup(
        "\uFEFF" + serializeDownloadSources([{ url: ` ${firstUrl} ` }])
      ),
      [firstUrl]
    );
  });

  it("rejects invalid JSON, unknown versions and invalid entries", () => {
    for (const value of [
      "not json",
      "null",
      "[]",
      '{"version":2,"sources":[]}',
      '{"version":1,"sources":[]}',
      '{"version":1,"sources":[null]}',
      '{"version":1,"sources":[{"url":42}]}',
      '{"version":1,"sources":[{"name":"Missing URL"}]}',
    ]) {
      assert.throws(() => parseDownloadSourceBackup(value));
    }
  });

  it("rejects local files, scripts, relative paths and malformed URLs", () => {
    for (const url of [
      "file:///C:/secret.json",
      "javascript:alert(1)",
      "ftp://example.com/source.json",
      "/source.json",
      "not a URL",
    ]) {
      assert.throws(() =>
        parseDownloadSourceBackup(serializeDownloadSources([{ url }]))
      );
    }
  });

  it("rejects oversized files by UTF-8 byte length", () => {
    assert.throws(() =>
      parseDownloadSourceBackup("é".repeat(MAX_DOWNLOAD_SOURCE_BACKUP_BYTES))
    );
  });

  it("accepts a backup at the entry limit", () => {
    const sources = Array.from(
      { length: MAX_DOWNLOAD_SOURCE_BACKUP_ENTRIES },
      (_, index) => ({ url: `https://example.com/${index}.json` })
    );
    assert.deepEqual(
      parseDownloadSourceBackup(serializeDownloadSources(sources)),
      sources.map(({ url }) => url)
    );
  });

  it("rejects too many entries before registering any source, including duplicates", async () => {
    for (const repeated of [false, true]) {
      const sources = Array.from(
        { length: MAX_DOWNLOAD_SOURCE_BACKUP_ENTRIES + 1 },
        (_, index) => ({
          url: repeated ? firstUrl : `https://example.com/${index}.json`,
        })
      );
      const contents = serializeDownloadSources(sources);
      assert(
        Buffer.byteLength(contents, "utf8") < MAX_DOWNLOAD_SOURCE_BACKUP_BYTES
      );
      let additions = 0;
      await assert.rejects(async () => {
        const urls = parseDownloadSourceBackup(contents);
        await importDownloadSourceUrls(urls, [], async () => {
          additions++;
        });
      }, /Invalid download source backup/);
      assert.equal(additions, 0);
    }
  });

  it("reports malformed JSON and URLs with a stable validation error", () => {
    for (const contents of [
      "not json",
      serializeDownloadSources([{ url: "not a URL" }]),
      serializeDownloadSources([{ url: "file:///C:/save.json" }]),
    ]) {
      assert.throws(() => parseDownloadSourceBackup(contents), {
        message: "Invalid download source backup",
      });
    }
  });

  it("validates the whole backup before beginning an import", async () => {
    let additions = 0;
    await assert.rejects(async () => {
      const urls = parseDownloadSourceBackup(
        serializeDownloadSources([{ url: firstUrl }, { url: "invalid" }])
      );
      await importDownloadSourceUrls(urls, [], async () => {
        additions++;
      });
    });
    assert.equal(additions, 0);
  });

  it("skips existing sources and repeated URLs without modifying them", async () => {
    const existing = [{ url: firstUrl, id: "original", name: "Keep me" }];
    const added: string[] = [];
    const result = await importDownloadSourceUrls(
      [firstUrl, secondUrl, secondUrl],
      existing,
      async (url) => {
        added.push(url);
      }
    );
    assert.deepEqual(result, { imported: 1, skipped: 2, failed: [] });
    assert.deepEqual(added, [secondUrl]);
    assert.deepEqual(existing, [
      { url: firstUrl, id: "original", name: "Keep me" },
    ]);
  });

  it("recognizes equivalent URL spellings as duplicates", async () => {
    const result = await importDownloadSourceUrls(
      ["https://EXAMPLE.COM:443/first.json"],
      [{ url: firstUrl }],
      async () => {
        assert.fail("Must not add a duplicate");
      }
    );
    assert.equal(result.skipped, 1);
  });

  it("registers sources sequentially instead of making concurrent requests", async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstRegistration = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const importing = importDownloadSourceUrls(
      [firstUrl, secondUrl],
      [],
      async (url) => {
        started.push(url);
        if (url === firstUrl) await firstRegistration;
      }
    );
    await Promise.resolve();
    assert.deepEqual(started, [firstUrl]);
    releaseFirst();
    assert.deepEqual(await importing, { imported: 2, skipped: 0, failed: [] });
    assert.deepEqual(started, [firstUrl, secondUrl]);
  });

  it("continues after a failed source and reports URLs that can be retried", async () => {
    const added: string[] = [];
    const result = await importDownloadSourceUrls(
      [firstUrl, secondUrl],
      [],
      async (url) => {
        if (url === firstUrl) throw new Error("Unavailable source");
        added.push(url);
      }
    );
    assert.deepEqual(result, { imported: 1, skipped: 0, failed: [firstUrl] });
    assert.deepEqual(added, [secondUrl]);
    const retry = await importDownloadSourceUrls(
      [firstUrl, secondUrl],
      [{ url: secondUrl }],
      async (url) => {
        added.push(url);
      }
    );
    assert.deepEqual(retry, { imported: 1, skipped: 1, failed: [] });
  });
});
