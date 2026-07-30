import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  getSteamStoreUserContext,
  parseActiveSteamUserId,
  parseSteamStoreUserContext,
} from "./steam-login-users.ts";

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

  it("returns every validated login with both Steam representations", () => {
    const context = parseSteamStoreUserContext(
      loginUsers(["76561197960278073", "1"], ["76561197960278074", "0"])
    );

    assert.equal(context.active?.steamId64, "76561197960278073");
    assert.equal(context.active?.accountId32, "12345");
    assert.deepEqual(
      context.known.map((account) => account.accountId32),
      ["12345", "12346"]
    );
  });

  it("adds validated userdata folders without changing the active login", async (t) => {
    const steamPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-steam-users-")
    );
    t.after(() => fs.promises.rm(steamPath, { recursive: true, force: true }));
    await fs.promises.mkdir(path.join(steamPath, "config"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(steamPath, "userdata", "12346"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(steamPath, "config", "loginusers.vdf"),
      loginUsers(["76561197960278073", "1"])
    );

    const context = await getSteamStoreUserContext(steamPath);

    assert.equal(context.active?.accountId32, "12345");
    assert.deepEqual(
      context.known.map((account) => account.accountId32),
      ["12345", "12346"]
    );
    assert.equal(context.known[1].source, "userdata-folder");
  });
});
