import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import {
  getLastArtworkRowIds,
  isAnimatedArtworkItem,
  isArtworkRowSettled,
} from "./game-artwork-utils.js";

describe("isAnimatedArtworkItem", () => {
  it("detects video artwork from either SteamGridDB URL", () => {
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
        thumb: "https://cdn2.steamgriddb.com/hero/example.webm",
      }),
      true
    );
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.mp4?download=1",
        thumb: "https://cdn2.steamgriddb.com/hero/example.webp",
      }),
      true
    );
  });

  it("treats image URLs as static", () => {
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
        thumb: "https://cdn2.steamgriddb.com/hero/example.png",
      }),
      false
    );
  });
});

describe("artwork pagination gate", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));

  it("returns only artwork ids from the last row", () => {
    assert.deepEqual(getLastArtworkRowIds(items, 4), [9, 10]);
    assert.deepEqual(getLastArtworkRowIds(items, 5), [6, 7, 8, 9, 10]);
  });

  it("waits for every artwork in the last row", () => {
    const lastRowIds = getLastArtworkRowIds(items, 4);

    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9])), false);
    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9, 10])), true);
  });

  it("does not let earlier rows block pagination", () => {
    const lastRowIds = getLastArtworkRowIds(items, 4);

    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9, 10])), true);
  });
});

describe("catalogue artwork identity", () => {
  it("browses Steam artwork while selections remain attached to the owned Epic game", async () => {
    const reads: unknown[][] = [];
    const writes: unknown[] = [];
    const selectionReads: unknown[][] = [];
    const module = {} as typeof import("./use-game-artwork-grid");
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        this.onload?.();
      }
    }
    runInNewContext(
      ts.transpileModule(
        fs.readFileSync(
          new URL("./use-game-artwork-grid.ts", import.meta.url),
          "utf8"
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports: module,
        require: (name: string) => {
          if (name === "react")
            return {
              useCallback: (callback: unknown) => callback,
              useEffect: () => {},
              useLayoutEffect: () => {},
              useRef: (current: unknown) => ({ current }),
              useState: (initial: unknown) => [initial, () => {}],
            };
          if (name === "./game-artwork-utils")
            return { isVideoArtworkUrl: () => false };
          assert.fail(`Unexpected dependency: ${name}`);
        },
        window: {
          electron: {
            getGameArtwork: async (...args: unknown[]) => {
              reads.push(args);
              return { items: [], hasMore: false };
            },
            getGameArtworkSelection: async (...args: unknown[]) => {
              selectionReads.push(args);
              return null;
            },
            setGameArtworkSelection: async (value: unknown) => {
              writes.push(value);
            },
          },
        },
        Image: LoadedImage,
        setTimeout,
        clearTimeout,
      }
    );
    const grid = module.useGameArtworkGrid({
      shop: "epic",
      objectId: "namespace:item",
      lookupIdentity: { shop: "steam", objectId: "123" },
      assetType: "icon",
      enabled: true,
      onChanged: () => {},
      onError: () => assert.fail("Unexpected error"),
    });
    grid.reload();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(reads[0], ["steam", "123", "icons", 0]);
    await grid.pick({
      id: 7,
      url: "https://artwork.test/icon.png",
    } as Parameters<typeof grid.pick>[0]);
    await grid.clear();
    assert.deepEqual(selectionReads, [
      ["epic", "namespace:item"],
      ["epic", "namespace:item"],
    ]);
    assert.equal((writes[0] as { shop: string }).shop, "epic");
    assert.equal(
      (writes[0] as { objectId: string }).objectId,
      "namespace:item"
    );
    assert.equal((writes[1] as { shop: string }).shop, "epic");
    assert.equal(
      (writes[1] as { objectId: string }).objectId,
      "namespace:item"
    );
  });
});
