import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankExecutableCandidates } from "./game-executable-ranking.js";

describe("downloaded game executable selection", () => {
  it("finds a known executable nested in an extracted game folder", () => {
    assert.equal(
      rankExecutableCandidates(
        [
          "Engine/Extras/Redist/setup.exe",
          "Binaries/Win64/Game.exe",
          "Binaries/Win64/CrashReportClient.exe",
        ],
        [{ name: "Binaries/Win64/Game.exe", exe: "game.exe" }]
      ),
      "Binaries/Win64/Game.exe"
    );
  });

  it("leaves a tied match or missing executable unset", () => {
    const known = [{ name: "game.exe", exe: "game.exe" }];

    assert.equal(
      rankExecutableCandidates(["A/game.exe", "B/game.exe"], known),
      null
    );
    assert.equal(rankExecutableCandidates(["setup.exe"], known), null);
  });
});
