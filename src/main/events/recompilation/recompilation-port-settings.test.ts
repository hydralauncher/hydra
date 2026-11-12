import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  getOnlineLaunchEnv,
  isValidPortName,
  readIniValue,
  setIniValues,
  toPortName,
} from "./recompilation-port-settings.js";

const RESERVED = ["ryupc", "ryunet", "player", "jugador", "guest"];

const online = (file: string) => ({
  enabledEnv: "BB_ONLINE",
  nameEnv: "BB_ONLINE_NAME",
  nameConfig: { file, keys: ["online_name", "user_name"] },
  reservedNames: RESERVED,
});

describe("port INI settings", () => {
  it("replaces a key and keeps every other line", () => {
    const ini = "# bbport settings\r\nonline=1\r\nfps_limit=60\r\n";
    assert.equal(
      setIniValues(ini, { online: "0", cloud_sync: "0" }),
      "# bbport settings\r\nonline=0\r\nfps_limit=60\r\ncloud_sync=0\r\n"
    );
  });

  it("writes a new file and reads values back", () => {
    const ini = setIniValues("", { game_dir: "C:\\Games\\CUSA13795" });
    assert.equal(ini, "game_dir=C:\\Games\\CUSA13795\n");
    assert.equal(readIniValue(ini, "game_dir"), "C:\\Games\\CUSA13795");
    assert.equal(readIniValue(ini, "online"), null);
  });
});

describe("port online names", () => {
  it("turns the Hydra name into one the port accepts", () => {
    assert.equal(toPortName("João Ávila", RESERVED), "JoaoAvila");
    assert.equal(
      toPortName("eight_lindão-2026!!", RESERVED),
      "eight_lindao-202"
    );
    assert.equal(toPortName("Jo", RESERVED), null);
    assert.equal(toPortName("Player", RESERVED), null);
    assert.equal(toPortName("日本語", RESERVED), null);
  });

  it("checks names like the port does", () => {
    assert.equal(isValidPortName("Speedy_Crash", RESERVED), true);
    assert.equal(isValidPortName("RyuPC", RESERVED), false);
    assert.equal(isValidPortName("a b c", RESERVED), false);
  });

  it("goes offline when signed out, online as the Hydra name when signed in", async () => {
    const missing = path.join(os.tmpdir(), "hydra-port-settings-missing.ini");
    assert.deepEqual(
      await getOnlineLaunchEnv(online(missing), (p) => p, null),
      {
        BB_ONLINE: "0",
      }
    );
    assert.deepEqual(
      await getOnlineLaunchEnv(online(missing), (p) => p, {
        displayName: "Rodrigo Ã",
      }),
      { BB_ONLINE: "1", BB_ONLINE_NAME: "RodrigoA" }
    );
    assert.deepEqual(
      await getOnlineLaunchEnv(online(missing), (p) => p, {
        displayName: "??",
      }),
      { BB_ONLINE: "0" }
    );
  });

  it("keeps the name the player set in the port", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-port-settings-"));
    const file = path.join(dir, "bbport.ini");
    fs.writeFileSync(file, "online=1\nonline_name=Kart_Master\n");
    try {
      assert.deepEqual(
        await getOnlineLaunchEnv(online(file), (p) => p, {
          displayName: "Someone Else",
        }),
        { BB_ONLINE: "1" }
      );
      fs.writeFileSync(file, "user_name=RyuPC\n");
      assert.deepEqual(
        await getOnlineLaunchEnv(online(file), (p) => p, {
          displayName: "Someone Else",
        }),
        { BB_ONLINE: "1", BB_ONLINE_NAME: "SomeoneElse" }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
