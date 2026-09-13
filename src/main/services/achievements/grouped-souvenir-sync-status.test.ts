import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PendingAchievementSouvenir } from "@types";
import {
  getAchievementSouvenirSyncStatusForOwner,
  prepareAchievementSouvenirForRetry,
} from "./grouped-souvenir-sync-status.js";

const createPending = (
  clientId: string,
  ownerId: string,
  status: PendingAchievementSouvenir["status"]
): PendingAchievementSouvenir => ({
  clientId,
  ownerId,
  remoteGameId: "game",
  gameKey: "steam:game",
  screenshotPath: `/screenshots/${clientId}.png`,
  capturedAt: 1,
  achievements: [{ name: "ACH", unlockTime: 1 }],
  status,
  attemptCount: 2,
  lastAttemptAt: 10,
  lastErrorCode: "failed",
});

describe("grouped souvenir sync status", () => {
  it("counts only records owned by the signed-in user", () => {
    const records = [
      createPending("pending", "owner", "pending"),
      createPending("failed", "owner", "terminal"),
      createPending("other", "other-owner", "terminal"),
    ];

    assert.deepEqual(
      getAchievementSouvenirSyncStatusForOwner(records, "owner"),
      { pendingCount: 1, failedCount: 1, errorCodes: ["failed"] }
    );
  });

  it("keeps a terminal record non-retryable", () => {
    const failed = createPending("failed", "owner", "terminal");

    assert.deepEqual(prepareAchievementSouvenirForRetry(failed), failed);
  });

  it("makes a pending record immediately retryable", () => {
    const pending = createPending("pending", "owner", "pending");

    assert.deepEqual(prepareAchievementSouvenirForRetry(pending), {
      ...pending,
      lastAttemptAt: undefined,
    });
  });
});
