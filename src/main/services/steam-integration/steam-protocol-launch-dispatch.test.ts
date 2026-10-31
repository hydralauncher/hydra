import assert from "node:assert/strict";
import test from "node:test";

import { dispatchSteamProtocolLaunch } from "./steam-protocol-launch-dispatch.ts";

test("falls back with the Steam Proton prefix when protocol opening fails", async () => {
  let fallbackPrefix: string | null = null;

  const result = await dispatchSteamProtocolLaunch(
    {
      url: "steam://rungameid/620",
      compatibilityPrefixPath: "/games/steamapps/compatdata/620/pfx",
    },
    async () => {
      throw new Error("Steam protocol unavailable");
    },
    async (compatibilityPrefixPath) => {
      fallbackPrefix = compatibilityPrefixPath;
      return 42;
    }
  );

  assert.equal(result.method, "fallback");
  assert.equal(result.value, 42);
  assert.equal(fallbackPrefix, "/games/steamapps/compatdata/620/pfx");
});

test("does not run the fallback after Steam accepts the protocol URL", async () => {
  let fallbackCalled = false;

  const result = await dispatchSteamProtocolLaunch(
    {
      url: "steam://rungameid/620",
      compatibilityPrefixPath: "/games/steamapps/compatdata/620/pfx",
    },
    async () => {},
    async () => {
      fallbackCalled = true;
      return 42;
    }
  );

  assert.equal(result.method, "steam");
  assert.equal(fallbackCalled, false);
});
