import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getGroupedSouvenirErrorCode,
  isTerminalGroupedSouvenirError,
} from "./grouped-souvenir-retry-policy.js";

const axiosError = (status: number, data: Record<string, unknown> = {}) => ({
  isAxiosError: true,
  response: { status, data },
});

describe("grouped souvenir retry policy", () => {
  it("stops retrying validation conflicts for the matching client", () => {
    const error = axiosError(409, {
      clientId: "client-1",
      code: "souvenir_conflict",
    });

    assert.equal(isTerminalGroupedSouvenirError(error, "client-1"), true);
    assert.equal(getGroupedSouvenirErrorCode(error), "souvenir_conflict");
  });

  it("does not terminate a different pending client", () => {
    const error = axiosError(409, { clientId: "client-2" });

    assert.equal(isTerminalGroupedSouvenirError(error, "client-1"), false);
  });

  it("keeps request-level rollout and validation errors retryable", () => {
    assert.equal(
      isTerminalGroupedSouvenirError(axiosError(404), "client-1"),
      false
    );
    assert.equal(
      isTerminalGroupedSouvenirError(axiosError(422), "client-1"),
      false
    );
  });

  it("keeps transient API failures retryable", () => {
    assert.equal(
      isTerminalGroupedSouvenirError(axiosError(429), "client-1"),
      false
    );
    assert.equal(
      isTerminalGroupedSouvenirError(axiosError(503), "client-1"),
      false
    );
  });
});
