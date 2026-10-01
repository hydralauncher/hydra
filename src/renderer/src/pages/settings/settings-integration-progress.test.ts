import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSteamProgressPresentation } from "./settings-integration-progress.js";

describe("getSteamProgressPresentation", () => {
  it("uses indeterminate progress before the game count is known", () => {
    assert.deepEqual(
      getSteamProgressPresentation({
        status: "running",
        syncRunId: "run",
        phase: "library",
        gamesFound: 0,
        gamesProcessed: 0,
      }),
      { mode: "indeterminate", percentage: null, showCount: false }
    );
  });

  it("reports determinate progress from zero through completion", () => {
    const makeState = (gamesProcessed: number) =>
      getSteamProgressPresentation({
        status: "running" as const,
        syncRunId: "run",
        phase: "achievements" as const,
        gamesFound: 4,
        gamesProcessed,
      });

    assert.deepEqual(makeState(0), {
      mode: "determinate",
      percentage: 0,
      showCount: true,
    });
    assert.deepEqual(makeState(2), {
      mode: "determinate",
      percentage: 50,
      showCount: true,
    });
    assert.deepEqual(makeState(4), {
      mode: "determinate",
      percentage: 100,
      showCount: true,
    });
  });

  it("clamps invalid processed counts", () => {
    const makeState = (gamesProcessed: number) =>
      getSteamProgressPresentation({
        status: "running" as const,
        syncRunId: "run",
        phase: "publishing" as const,
        gamesFound: 4,
        gamesProcessed,
      });

    assert.equal(makeState(-1)?.percentage, 0);
    assert.equal(makeState(5)?.percentage, 100);
  });
});
