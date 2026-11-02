import assert from "node:assert/strict";
import test from "node:test";
import {
  EPIC_AUTH_CODE_MIN_LENGTH,
  EPIC_AUTH_CODE_MAX_LENGTH,
  EPIC_AUTH_RESPONSE_MAX_LENGTH,
  parseEpicAuthorizationResponse,
  validateEpicAuthorizationCode,
} from "./auth-protocol.ts";

for (const length of [EPIC_AUTH_CODE_MIN_LENGTH, EPIC_AUTH_CODE_MAX_LENGTH]) {
  test(`authorization codes at length ${length} are accepted unchanged`, () => {
    const code = "aZ0_-".repeat(length).slice(0, length);
    assert.equal(validateEpicAuthorizationCode(code), code);
    assert.equal(
      parseEpicAuthorizationResponse(
        JSON.stringify({ authorizationCode: code })
      ),
      code
    );
  });
}

test("authorization codes outside the length bounds or alphabet are rejected", () => {
  for (const code of [
    "a".repeat(EPIC_AUTH_CODE_MIN_LENGTH - 1),
    "a".repeat(EPIC_AUTH_CODE_MAX_LENGTH + 1),
    ...[" ", ".", "!", "\n", "\0", "é"].map(
      (character) => `a${character}${"a".repeat(EPIC_AUTH_CODE_MIN_LENGTH)}`
    ),
  ]) {
    assert.throws(() => validateEpicAuthorizationCode(code), {
      code: "invalid-response",
    });
    assert.throws(
      () =>
        parseEpicAuthorizationResponse(
          JSON.stringify({ authorizationCode: code })
        ),
      { code: "invalid-response" }
    );
  }
});

test("authorization code validation does not coerce non-string values", () => {
  for (const input of [undefined, null, true, 123, [], {}]) {
    assert.throws(() => validateEpicAuthorizationCode(input), {
      code: "invalid-response",
    });
  }
});

test("the authorization response keeps its JSON size limit separate from the code", () => {
  const code = "a".repeat(EPIC_AUTH_CODE_MAX_LENGTH);
  const response = JSON.stringify({ authorizationCode: code }).padEnd(
    EPIC_AUTH_RESPONSE_MAX_LENGTH,
    " "
  );
  assert.equal(parseEpicAuthorizationResponse(response), code);
  assert.throws(() => parseEpicAuthorizationResponse(`${response} `), {
    code: "invalid-response",
  });
});
