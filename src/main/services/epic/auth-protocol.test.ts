import assert from "node:assert/strict";
import test from "node:test";
import {
  EPIC_OAUTH_CLIENT_ID,
  getEpicLoginUrl,
  isEpicAuthorizationReturn,
  isHttpsNavigation,
  parseEpicAuthorizationResponse,
  validateLegendarySession,
  validateLegendaryVersion,
} from "./auth-protocol.ts";

const code = "testAuthorizationCode123456789";
const callback = `https://www.epicgames.com/id/api/redirect?clientId=${EPIC_OAUTH_CLIENT_ID}&responseType=code`;

test("accepts only the pinned Epic HTTPS main-frame return", () => {
  assert.equal(isEpicAuthorizationReturn(callback), true);
  for (const bad of [
    callback.replace("https:", "http:"),
    callback.replace("www.epicgames.com", "www.epicgames.com.evil.test"),
    callback.replace("www.epicgames.com", "user:password@www.epicgames.com"),
    callback.replace("/id/api/redirect", "/id/api/redirect/"),
    callback.replace(EPIC_OAUTH_CLIENT_ID, "different-client"),
    `${callback}&clientId=${EPIC_OAUTH_CLIENT_ID}`,
    `${callback}&responseType=token`,
    callback.replace(".com/", ".com:444/"),
    "javascript:alert(1)",
  ])
    assert.equal(isEpicAuthorizationReturn(bad), false, bad);
  const login = new URL(getEpicLoginUrl());
  assert.equal(login.origin, "https://www.epicgames.com");
  assert.equal(login.searchParams.get("redirectUrl"), callback);
});

test("extracts only a valid code from Epic response and rejects malformed provider data", () => {
  assert.equal(
    parseEpicAuthorizationResponse(JSON.stringify({ authorizationCode: code })),
    code
  );
  for (const bad of [
    code,
    JSON.stringify(code),
    "",
    "x".repeat(4097),
    '{"authorizationCode":12}',
    '{"authorizationCode":"bad"}',
    '{"authorizationCode":null}',
    "{}",
    "{",
    null,
  ]) {
    assert.throws(
      () => parseEpicAuthorizationResponse(bad),
      /invalid-response/
    );
  }
  assert.equal(isHttpsNavigation("https://accounts.google.com/"), true);
  assert.equal(isHttpsNavigation("hydra://auth"), false);
  assert.equal(isHttpsNavigation("file:///tmp/credentials"), false);
});

export const testLegendaryUser = () => ({
  account_id: "a".repeat(32),
  displayName: "Test Epic",
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  client_id: EPIC_OAUTH_CLIENT_ID,
});

test("requires identity and both session tokens and rejects effective client changes", () => {
  assert.equal(
    validateLegendarySession(testLegendaryUser()).displayName,
    "Test Epic"
  );
  for (const key of [
    "account_id",
    "access_token",
    "refresh_token",
    "expires_at",
    "refresh_expires_at",
  ]) {
    const user: Record<string, unknown> = testLegendaryUser();
    delete user[key];
    assert.throws(() => validateLegendarySession(user), /auth-failed/);
  }
  assert.throws(
    () =>
      validateLegendarySession({
        ...testLegendaryUser(),
        client_id: "new-client",
      }),
    /oauth-client-mismatch/
  );
  assert.throws(
    () =>
      validateLegendaryVersion({
        data: { egl_config: { client_id: "new-client" } },
      }),
    /oauth-client-mismatch/
  );
  assert.deepEqual(validateLegendaryVersion({ data: { egl_config: {} } }), {
    data: { egl_config: {} },
  });
});
