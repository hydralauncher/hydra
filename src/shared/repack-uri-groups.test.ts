import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Downloader } from "./constants.js";
import {
  getUriGroupParts,
  normalizeUriGroups,
  withoutMultipartHosterDownloads,
} from "./repack-uri-groups.js";

const getDownloadersForUri = (uri: string): Downloader[] => {
  if (uri.startsWith("https://fuckingfast.co")) return [Downloader.FuckingFast];
  if (uri.startsWith("https://gofile.io")) return [Downloader.Gofile];
  if (uri.startsWith("https://1fichier.com")) return [Downloader.RealDebrid];
  if (uri.startsWith("magnet:")) return [Downloader.Torrent];
  return [];
};

const fuckingFastParts = [
  "https://fuckingfast.co/a#Game.part1.rar",
  "https://fuckingfast.co/b#Game.part2.rar",
  "https://fuckingfast.co/c#Game.part3.rar",
];

describe("normalizeUriGroups", () => {
  it("lists each group's first part as one download option", () => {
    const repack = normalizeUriGroups(
      { uris: ["magnet:?xt=1"], uriGroups: [fuckingFastParts] },
      getDownloadersForUri
    );

    assert.deepEqual(repack.uris, ["magnet:?xt=1", fuckingFastParts[0]]);
    assert.deepEqual(repack.uriGroups, [fuckingFastParts]);
    assert.deepEqual(
      getUriGroupParts(repack, fuckingFastParts[0]),
      fuckingFastParts
    );
    assert.equal(getUriGroupParts(repack, "magnet:?xt=1"), undefined);
  });

  it("keeps repacks without groups unchanged", () => {
    const repack = { uris: ["magnet:?xt=1"] };
    assert.equal(normalizeUriGroups(repack, getDownloadersForUri), repack);
  });

  it("drops groups that mix hosters or need a debrid service", () => {
    const repack = normalizeUriGroups(
      {
        uris: [],
        uriGroups: [
          [fuckingFastParts[0], "https://gofile.io/d/x"],
          ["https://1fichier.com/?a", "https://1fichier.com/?b"],
        ],
      },
      getDownloadersForUri
    );

    assert.deepEqual(repack.uris, []);
    assert.deepEqual(repack.uriGroups, []);
  });

  it("drops malformed groups", () => {
    const repack = normalizeUriGroups(
      {
        uris: [fuckingFastParts[1]],
        uriGroups: [
          [fuckingFastParts[0]],
          [fuckingFastParts[0], fuckingFastParts[0]],
          [fuckingFastParts[0], 42] as unknown as string[],
          "not a group" as unknown as string[],
          [fuckingFastParts[1], fuckingFastParts[2]],
        ],
      },
      getDownloadersForUri
    );

    assert.deepEqual(repack.uris, [fuckingFastParts[1]]);
    assert.deepEqual(repack.uriGroups, []);
  });
});

describe("withoutMultipartHosterDownloads", () => {
  it("drops groups and links only the feature supports", () => {
    const repack = withoutMultipartHosterDownloads({
      uris: [
        "magnet:?xt=1",
        fuckingFastParts[0],
        "https://fuckingfast.net/d#Game.rar",
        "https://filekeeper.net/e/Game.rar",
      ],
      uriGroups: [fuckingFastParts],
    });

    assert.deepEqual(repack.uris, ["magnet:?xt=1", fuckingFastParts[0]]);
    assert.equal(repack.uriGroups, undefined);
  });
});
