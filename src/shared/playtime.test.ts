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
        epicPlayTimeInMilliseconds: 0,
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
        epicPlayTimeInMilliseconds: 0,
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
        epicPlayTimeInMilliseconds: 0,
      }
    );
  });
});

it("replaces Epic totals without reattributing aggregate time to Hydra", () => {
  const local = {
    playTimeInMilliseconds: 10,
    steamPlayTimeInMilliseconds: 20,
    epicPlayTimeInMilliseconds: 30,
  };
  const remote = {
    playTimeInMilliseconds: 999999,
    runtimeByPlatform: { hydra: 0, steam: 2, epic: 3 },
  };
  const merged = mergeLocalAndRemotePlayTime(local, remote);
  assert.deepEqual(merged, {
    playTimeInMilliseconds: 10,
    steamPlayTimeInMilliseconds: 2000,
    epicPlayTimeInMilliseconds: 3000,
  });
  assert.deepEqual(mergeLocalAndRemotePlayTime(merged, remote), merged);
  assert.equal(getDisplayedPlayTimeInMilliseconds(merged), 5010);
  assert.equal(
    mergeLocalAndRemotePlayTime(merged, {
      runtimeByPlatform: { hydra: 0, steam: 2, epic: 0 },
    }).epicPlayTimeInMilliseconds,
    0
  );
});

it("discounts imports only when the Hydra attribution is absent", () => {
  assert.equal(
    mergeLocalAndRemotePlayTime(
      {},
      { playTimeInSeconds: 50, runtimeByPlatform: { steam: 10, epic: 20 } }
    ).playTimeInMilliseconds,
    20000
  );
  assert.equal(
    mergeLocalAndRemotePlayTime(
      {},
      {
        playTimeInSeconds: 50,
        runtimeByPlatform: { hydra: 0, steam: 10, epic: 20 },
      }
    ).playTimeInMilliseconds,
    0
  );
});

it("preserves Epic contribution when an older API omits its fields and does not copy it into Hydra", () => {
  const local = {
    playTimeInMilliseconds: 1000,
    epicPlayTimeInMilliseconds: 3000,
  };
  assert.deepEqual(
    mergeLocalAndRemotePlayTime(local, {
      runtimeByPlatform: { hydra: 0, steam: 2 },
    }),
    {
      playTimeInMilliseconds: 1000,
      steamPlayTimeInMilliseconds: 2000,
      epicPlayTimeInMilliseconds: 3000,
    }
  );
  assert.equal(
    mergeLocalAndRemotePlayTime(local, {
      playTimeInSeconds: 8,
      runtimeByPlatform: { steam: 2 },
    }).playTimeInMilliseconds,
    3000
  );
  assert.equal(
    mergeLocalAndRemotePlayTime(local, {
      hasActiveEpicImport: false,
      runtimeByPlatform: { hydra: 0, steam: 2 },
    }).epicPlayTimeInMilliseconds,
    0
  );
});
