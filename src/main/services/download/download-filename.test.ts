import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractDownloadFilename } from "./download-filename.ts";

const escapedTrackerMagnet =
  "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Cuphead&#038;tr=http%3A%2F%2Fbt.t-ru.org%2Fann%3Fmagnet&#038;tr=udp%3A%2F%2Fopentor.net%3A6969";
const realDebridLink =
  "https://abcd.download.real-debrid.com/d/ABCDEF123/Cuphead_1.3.9_(85531)_win_gog.rar";

describe("extractDownloadFilename", () => {
  it("uses the debrid link name when the magnet has escaped trackers", () => {
    const filename =
      extractDownloadFilename(escapedTrackerMagnet, realDebridLink) ??
      extractDownloadFilename(realDebridLink);

    assert.equal(filename, "Cuphead_1.3.9_(85531)_win_gog.rar");
  });

  it("never derives a filename from a magnet uri", () => {
    assert.equal(extractDownloadFilename(escapedTrackerMagnet), undefined);
  });

  it("keeps filename hints appended after a hash", () => {
    assert.equal(
      extractDownloadFilename("https://host.example/get/abc#Game Name.rar"),
      "Game Name.rar"
    );
  });

  it("prefers the original url hint over the resolved url", () => {
    assert.equal(
      extractDownloadFilename(
        "https://cdn.example/files/ignored.bin",
        "https://host.example/page#Original.zip"
      ),
      "Original.zip"
    );
  });

  it("ignores query-like hash fragments", () => {
    assert.equal(
      extractDownloadFilename("https://host.example/get?id=1&#038;name=a.b"),
      undefined
    );
  });

  it("ignores hash fragments that are urls or have no extension", () => {
    assert.equal(
      extractDownloadFilename("https://host.example/a#https://other/b.rar"),
      undefined
    );
    assert.equal(
      extractDownloadFilename("https://host.example/file#section"),
      undefined
    );
  });

  it("decodes the last path segment", () => {
    assert.equal(
      extractDownloadFilename("https://host.example/d/My%20Game%20v1.2.7z"),
      "My Game v1.2.7z"
    );
  });
});
