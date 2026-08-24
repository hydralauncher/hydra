import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSouvenirSyncErrorTranslationKeys } from "./souvenir-sync.js";

describe("souvenir sync messages", () => {
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
});
