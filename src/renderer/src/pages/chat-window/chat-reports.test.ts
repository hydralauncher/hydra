import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getReportErrorKind } from "./chat-reports.js";

describe("getReportErrorKind", () => {
  it("tells the rate limit apart from other failures", () => {
    assert.equal(
      getReportErrorKind(new Error("429 chat/rate-limited")),
      "rate_limited"
    );
    assert.equal(getReportErrorKind(new Error("network")), "failed");
    assert.equal(getReportErrorKind("chat/rate-limited"), "failed");
  });
});
