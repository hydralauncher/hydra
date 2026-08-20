import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getGroupedSouvenirErrorCode,
  isMissingGroupedSouvenirScreenshot,
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

  it("stops retrying an acknowledged souvenir conflict without a client ID", () => {
    const error = axiosError(409, {
      message: "achievements/souvenir-conflict",
    });

    assert.equal(isTerminalGroupedSouvenirError(error, "client-1"), true);
  });

  it("stops retrying terminal upload conflicts without a client ID", () => {
    for (const message of [
      "achievements/souvenir-upload-deleted",
      "achievements/souvenir-upload-length-mismatch",
    ]) {
      assert.equal(
        isTerminalGroupedSouvenirError(
          axiosError(409, { message }),
          "client-1"
        ),
        true
      );
    }
  });

  it("identifies when the local screenshot no longer exists", () => {
    const error = Object.assign(new Error("Screenshot not found"), {
      code: "ENOENT",
    });

    assert.equal(isMissingGroupedSouvenirScreenshot(error), true);
    assert.equal(
      getGroupedSouvenirErrorCode(error),
      "souvenir_screenshot_missing"
    );
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
