import assert from "node:assert/strict";
import { it } from "node:test";

import type { Game } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { manualCardSelectionFor } from "./emulator-card-manual-selection.ts";

const game = (platform: string) => ({ shop: "launchbox", platform }) as Game;

it("routes shared card images to per-game providers", () => {
  assert.equal(
    manualCardSelectionFor(
      game("Sony PlayStation 2"),
      "/cards/Mcd001.ps2",
      false
    )?.provider,
    "pcsx2"
  );
  assert.equal(
    manualCardSelectionFor(
      game("Nintendo GameCube"),
      "/cards/MemoryCardA.raw",
      false
    )?.provider,
    "dolphin"
  );
  assert.equal(
    manualCardSelectionFor(
      game("Super Nintendo Entertainment System"),
      "/saves/Super Mario World.srm",
      false
    ),
    null
  );
});
