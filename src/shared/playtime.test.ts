import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getDisplayedPlayTimeInMilliseconds,
  getPlayTimeHoursAndMinutes,
  mergeLocalAndRemotePlayTime,
} from "./playtime.js";

describe("getDisplayedPlayTimeInMilliseconds", () => {
  it("sums Hydra and Steam playtime", () => {
    assert.equal(
      getDisplayedPlayTimeInMilliseconds({
        playTimeInMilliseconds: 3_600_000,
        steamPlayTimeInMilliseconds: 7_200_000,
      }),
      10_800_000
    );
  });

  it("treats missing Steam playtime as zero", () => {
    assert.equal(
      getDisplayedPlayTimeInMilliseconds({
        playTimeInMilliseconds: 1_000,
      }),
      1_000
    );
  });
});

describe("getPlayTimeHoursAndMinutes", () => {
  it("splits milliseconds into hours and leftover minutes", () => {
    assert.deepEqual(getPlayTimeHoursAndMinutes(7_800_000), {
      hours: 2,
      minutes: 10,
    });
    assert.deepEqual(getPlayTimeHoursAndMinutes(-1), {
      hours: 0,
      minutes: 0,
    });
  });
});

describe("mergeLocalAndRemotePlayTime", () => {
  it("keeps local Hydra hours and adds Steam from runtimeByPlatform", () => {
    assert.deepEqual(
      mergeLocalAndRemotePlayTime(
        { playTimeInMilliseconds: 360_000_000 },
        {
          playTimeInMilliseconds: 187_200_000,
          runtimeByPlatform: { hydra: 7_200, steam: 180_000 },
        }
      ),
      {
        playTimeInMilliseconds: 360_000_000,
        steamPlayTimeInMilliseconds: 180_000_000,
      }
    );
  });

  it("uses remote Hydra when it is higher than local", () => {
    assert.deepEqual(
      mergeLocalAndRemotePlayTime(
        { playTimeInMilliseconds: 1_000 },
        {
          runtimeByPlatform: { hydra: 10, steam: 50 },
        }
      ),
      {
        playTimeInMilliseconds: 10_000,
        steamPlayTimeInMilliseconds: 50_000,
      }
    );
  });

  it("falls back to the combined total when platforms are missing", () => {
    assert.deepEqual(
      mergeLocalAndRemotePlayTime(
        { playTimeInMilliseconds: 1_000 },
        { playTimeInMilliseconds: 5_000 }
      ),
      {
        playTimeInMilliseconds: 5_000,
        steamPlayTimeInMilliseconds: 0,
      }
    );
  });
});
