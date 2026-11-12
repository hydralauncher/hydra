import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSouvenirSyncErrorTranslationKeys,
  getSouvenirSyncMessage,
} from "./souvenir-sync.js";

describe("souvenir sync messages", () => {
  it("prioritizes the missing subscription over other souvenir failures", () => {
    assert.deepEqual(
      getSouvenirSyncMessage({
        pendingCount: 1,
        failedCount: 3,
        errorCodes: [
          "game/not-found",
          "subscription/active-subscription-required",
        ],
      }),
      {
        titleKey: "souvenir_sync_paused_title",
        key: "souvenir_sync_error_subscription_required",
      }
    );
  });

  it("shows one concise summary when there are several different failures", () => {
    assert.deepEqual(
      getSouvenirSyncMessage({
        pendingCount: 2,
        failedCount: 1,
        errorCodes: ["reservation_mismatch", "game/not-found"],
      }),
      {
        titleKey: "souvenir_sync_status_title",
        key: "souvenir_sync_issues",
        count: 3,
      }
    );
  });

  it("uses the specific explanation for a single known failure", () => {
    assert.equal(
      getSouvenirSyncMessage({
        pendingCount: 0,
        failedCount: 2,
        errorCodes: ["game/not-found"],
      }).key,
      "souvenir_sync_error_game_missing"
    );
  });
  it("explains missing games and subscription pauses", () => {
    assert.deepEqual(
      getSouvenirSyncErrorTranslationKeys([
        "achievements/souvenir-not-found",
        "game/not-found",
        "subscription/active-subscription-required",
      ]),
      [
        "souvenir_sync_error_game_missing",
        "souvenir_sync_error_subscription_required",
      ]
    );
  });
  it("deduplicates errors that share the same explanation", () => {
    assert.deepEqual(
      getSouvenirSyncErrorTranslationKeys([
        "reservation_not_found",
        "achievements/souvenir-upload-expired",
      ]),
      ["souvenir_sync_error_reservation_not_found"]
    );
  });

  it("ignores errors without a user-facing explanation", () => {
    assert.deepEqual(
      getSouvenirSyncErrorTranslationKeys(["http_500", "unknown_error"]),
      []
    );
  });

  it("explains when the souvenir collection is full", () => {
    assert.deepEqual(
      getSouvenirSyncErrorTranslationKeys([
        "achievements/souvenir-limit-reached",
      ]),
      ["souvenir_sync_error_limit_reached"]
    );
  });
});
