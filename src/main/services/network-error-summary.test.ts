import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, type AxiosResponse } from "axios";
import { summarizeNetworkError } from "./network-error-summary.ts";

test("Axios diagnostics retain status/code without exposing credentials anywhere in an error", () => {
  const secret = "test-only-sensitive-value";
  const config = {
    headers: { Authorization: `Bearer ${secret}`, Cookie: secret },
    url: `https://example.com/auth?exchange_code=${secret}`,
    data: JSON.stringify({ exchangeCode: secret, access_token: secret }),
  };
  const error = new AxiosError(
    `Request failed: ${secret}`,
    "ERR_BAD_RESPONSE",
    config as never,
    { credential: secret },
    {
      status: 502,
      data: { access_token: secret, refresh_token: secret, message: secret },
      headers: { "set-cookie": secret },
      config,
    } as unknown as AxiosResponse
  );
  error.stack = secret;
  const summary = summarizeNetworkError(error);
  assert.deepEqual(summary, {
    name: "AxiosError",
    code: "ERR_BAD_RESPONSE",
    status: 502,
  });
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.equal(summary instanceof Error, false);
});

test("unknown error properties and free-form messages never become diagnostics", () => {
  const secret = "test-only-sensitive-value";
  for (const error of [
    Object.assign(new Error(secret), {
      name: secret,
      code: secret,
      response: { status: secret },
    }),
    secret,
    null,
    {
      get name() {
        throw new Error(secret);
      },
    },
  ]) {
    const summary = summarizeNetworkError(error);
    assert.equal(JSON.stringify(summary).includes(secret), false);
    assert.equal("message" in summary, false);
    assert.equal("stack" in summary, false);
  }
  assert.deepEqual(
    summarizeNetworkError(
      Object.assign(new Error("socket failed"), { code: "ECONNRESET" })
    ),
    {
      name: "Error",
      code: "ECONNRESET",
    }
  );
});
