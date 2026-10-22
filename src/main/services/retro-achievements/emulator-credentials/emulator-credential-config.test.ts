import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readDolphinAccount,
  readPcsx2Account,
  readPpssppUsername,
  readRetroArchAccount,
  shouldWriteEmulatorAccount,
  writeDolphinAccount,
  writePcsx2Account,
  writePcsx2Token,
  writePpssppUsername,
  writeRetroArchAccount,
} from "./emulator-credential-config.js";

describe("emulator RetroAchievements account decisions", () => {
  it("writes when no account is signed in", () => {
    assert.equal(
      shouldWriteEmulatorAccount({ username: null, hasToken: false }, "Player"),
      true
    );
  });

  it("fills a missing token for the same account", () => {
    assert.equal(
      shouldWriteEmulatorAccount(
        { username: "player", hasToken: false },
        "Player"
      ),
      true
    );
  });

  it("never touches a signed in or different account", () => {
    assert.equal(
      shouldWriteEmulatorAccount(
        { username: "player", hasToken: true },
        "Player"
      ),
      false
    );
    assert.equal(
      shouldWriteEmulatorAccount(
        { username: "other", hasToken: false },
        "Player"
      ),
      false
    );
  });
});

describe("emulator RetroAchievements config values", () => {
  it("signs RetroArch in without touching cheevos_enable", () => {
    const original =
      'cheevos_enable = "false"\ncheevos_username = ""\ncheevos_password = "secret"\n';
    const signedIn = writeRetroArchAccount(original, "Player", "TOKEN");

    assert.deepEqual(readRetroArchAccount(original), {
      username: null,
      hasToken: false,
    });
    assert.deepEqual(readRetroArchAccount(signedIn), {
      username: "Player",
      hasToken: true,
    });
    assert.match(signedIn, /cheevos_enable = "false"/);
    assert.match(signedIn, /cheevos_password = ""/);
  });

  it("reads PCSX2 tokens from either the base or secrets file", () => {
    const base = writePcsx2Account(
      "[Achievements]\nEnabled = true\n",
      "Player",
      5
    );
    const secrets = writePcsx2Token("", "TOKEN");

    assert.deepEqual(readPcsx2Account(base, null), {
      username: "Player",
      hasToken: false,
    });
    assert.deepEqual(readPcsx2Account(base, secrets), {
      username: "Player",
      hasToken: true,
    });
    assert.deepEqual(
      readPcsx2Account(writePcsx2Token(base, "TOKEN"), null).hasToken,
      true
    );
  });

  it("sets the PPSSPP username", () => {
    const signedIn = writePpssppUsername(
      "[Achievements]\nAchievementsEnable = False\nAchievementsUserName = \n",
      "Player"
    );

    assert.equal(readPpssppUsername(signedIn), "Player");
    assert.match(signedIn, /AchievementsEnable = False/);
  });

  it("creates Dolphin RetroAchievements values from an empty file", () => {
    const signedIn = writeDolphinAccount("", "Player", "TOKEN");

    assert.deepEqual(readDolphinAccount(signedIn), {
      username: "Player",
      hasToken: true,
    });
  });
});
