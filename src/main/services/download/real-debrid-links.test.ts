import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DownloadError } from "../../../shared/constants.ts";
import type { RealDebridTorrentInfo } from "../../../types/download.types";
import {
  canUseRealDebridArchiveLink,
  hasRealDebridSelection,
  isRealDebridArchiveCandidate,
  waitForRealDebridLinks,
} from "./real-debrid-links.ts";

const files = [
  { id: 1, path: "/item/a.bin", bytes: 10, selected: 1 },
  { id: 2, path: "/item/b.bin", bytes: 20, selected: 1 },
];

const infoWithLinks = (links: string[]) =>
  ({ status: "downloaded", files, links }) as RealDebridTorrentInfo;

describe("Real-Debrid link readiness", () => {
  it("waits for all selected file links before pairing them", async () => {
    let requests = 0;
    let waits = 0;
    const result = await waitForRealDebridLinks(
      async () =>
        infoWithLinks(++requests === 1 ? ["first"] : ["first", "second"]),
      async () => {
        waits++;
      }
    );

    assert.equal(requests, 2);
    assert.equal(waits, 1);
    assert.deepEqual(result?.selectedFiles, files);
    assert.deepEqual(result?.info.links, ["first", "second"]);
  });

  it("keeps a persistent mismatch pending without assigning the wrong link", async () => {
    let requests = 0;
    await assert.rejects(
      waitForRealDebridLinks(
        async () => {
          requests++;
          return infoWithLinks(["first"]);
        },
        async () => undefined
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, DownloadError.RealDebridLinksNotReady);
        assert.deepEqual(error.cause, { selectedFiles: 2, links: 1 });
        return true;
      }
    );
    assert.equal(requests, 10);
  });

  it("leaves a torrent in provider processing when it is not downloaded", async () => {
    let waits = 0;
    const result = await waitForRealDebridLinks(
      async () => ({ ...infoWithLinks([]), status: "downloading" }),
      async () => {
        waits++;
      }
    );
    assert.equal(result, null);
    assert.equal(waits, 0);
  });

  it("accepts a settled archive for an unchanged selection", () => {
    const now = Date.parse("2026-01-01T01:02:00Z");
    const info = {
      ...infoWithLinks(["restricted"]),
      ended: "2026-01-01T01:00:00Z",
    };

    assert.equal(isRealDebridArchiveCandidate(info, undefined, now), true);
    assert.equal(
      canUseRealDebridArchiveLink(info, "bundle.zip", undefined, now),
      true
    );
    assert.equal(
      canUseRealDebridArchiveLink(info, "a.bin", undefined, now),
      false
    );
    assert.equal(
      canUseRealDebridArchiveLink(info, "a.bin.zip", [1], now),
      false
    );
    assert.equal(
      canUseRealDebridArchiveLink(info, "bundle.zip", undefined, now - 61_000),
      false
    );
  });

  it("requires a new torrent when the requested files differ", () => {
    const info = infoWithLinks(["archive-link"]);
    assert.equal(hasRealDebridSelection(info, [1, 2]), true);
    assert.equal(hasRealDebridSelection(info, [1]), false);
    assert.equal(hasRealDebridSelection(info, [1, 3]), false);
    assert.equal(hasRealDebridSelection(info), true);
  });
});
