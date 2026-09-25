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
  it("uses ready metadata without requesting it a second time", async () => {
    const result = await waitForRealDebridLinks(
      async () => {
        throw new Error("unexpected metadata request");
      },
      async () => undefined,
      infoWithLinks(["first", "second"])
    );
    assert.deepEqual(result?.info.links, ["first", "second"]);
  });

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

  it("accepts a verified archive without a fixed age delay", () => {
    const info = {
      ...infoWithLinks(["restricted"]),
      ended: "2026-01-01T01:00:00Z",
    };

    assert.equal(isRealDebridArchiveCandidate(info), true);
    assert.equal(canUseRealDebridArchiveLink(info, "bundle.zip"), true);
    assert.equal(canUseRealDebridArchiveLink(info, "a.bin"), false);
    assert.equal(canUseRealDebridArchiveLink(info, "a.bin.zip", [1]), false);
    assert.equal(isRealDebridArchiveCandidate({ ...info, ended: "" }), false);
  });

  it("requires a new torrent when the requested files differ", () => {
    const info = infoWithLinks(["archive-link"]);
    assert.equal(hasRealDebridSelection(info, [1, 2]), true);
    assert.equal(hasRealDebridSelection(info, [1]), false);
    assert.equal(hasRealDebridSelection(info, [1, 3]), false);
    assert.equal(hasRealDebridSelection(info), true);
    assert.equal(
      hasRealDebridSelection(
        {
          ...info,
          files: [files[0], { ...files[1], selected: 0 }],
        },
        undefined
      ),
      false
    );
  });
});
