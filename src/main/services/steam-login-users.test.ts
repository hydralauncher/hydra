import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseActiveSteamUserId } from "./steam-login-users.ts";

const loginUsers = (...users: Array<[string, string]>) => `
"users"
{
${users
  .map(
    ([steamId, mostRecent]) => `
  "${steamId}"
  {
    "AccountName" "victor"
    "MostRecent" "${mostRecent}"
  }`
  )
  .join("\n")}
}
`;

describe("Steam login user detection", () => {
  it("selects the only most recent SteamID64", () => {
    assert.equal(
      parseActiveSteamUserId(
        loginUsers(["76561198000000001", "0"], ["76561198051718575", "1"])
      ),
      "76561198051718575"
    );
  });

  it("uses the only account when MostRecent is absent", () => {
    assert.equal(
      parseActiveSteamUserId(loginUsers(["76561198051718575", "0"])),
      "76561198051718575"
    );
  });

  it("does not guess between ambiguous accounts", () => {
    assert.equal(
      parseActiveSteamUserId(
        loginUsers(["76561198000000001", "0"], ["76561198051718575", "0"])
      ),
      undefined
    );
    assert.equal(
      parseActiveSteamUserId(
        loginUsers(["76561198000000001", "1"], ["76561198051718575", "1"])
      ),
      undefined
    );
  });

  it("rejects malformed files and non-SteamID64 keys", () => {
    assert.equal(parseActiveSteamUserId('"users" { "broken"'), undefined);
    assert.equal(parseActiveSteamUserId(loginUsers(["12345", "1"])), undefined);
  });
});
