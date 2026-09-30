import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  STEAM_APP_INFO_MAGIC_V39,
  STEAM_APP_INFO_MAGIC_V40,
  STEAM_APP_INFO_MAGIC_V41,
  parseBinaryKeyValues,
  readSteamAppInfo,
  resolveSteamAppExecutable,
  selectSteamLaunchCandidates,
  toSteamExecutableSegments,
  type SteamAppInfo,
  type SteamLaunchEntry,
} from "./steam-app-info-core.ts";

type TestKeyValues = { [key: string]: string | number | TestKeyValues };

const cString = (value: string) =>
  Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);

const uint32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const int32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
};

const encodeKeyValues = (
  value: TestKeyValues,
  stringTable: string[] | null
): Buffer => {
  const encodeKey = (key: string) => {
    if (!stringTable) return cString(key);

    let index = stringTable.indexOf(key);
    if (index === -1) {
      index = stringTable.length;
      stringTable.push(key);
    }

    return uint32(index);
  };

  const parts: Buffer[] = [];

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      parts.push(Buffer.from([0x01]), encodeKey(key), cString(child));
    } else if (typeof child === "number") {
      parts.push(Buffer.from([0x02]), encodeKey(key), int32(child));
    } else {
      parts.push(
        Buffer.from([0x00]),
        encodeKey(key),
        encodeKeyValues(child, stringTable)
      );
    }
  }

  parts.push(Buffer.from([0x08]));
  return Buffer.concat(parts);
};

const buildAppInfoFile = (
  magic: number,
  apps: { appId: number; keyValues: TestKeyValues }[]
) => {
  const isV41 = magic === STEAM_APP_INFO_MAGIC_V41;
  const fixedFieldsSize = magic === STEAM_APP_INFO_MAGIC_V39 ? 40 : 60;
  const stringTable = isV41 ? ([] as string[]) : null;

  const entries = apps.map(({ appId, keyValues }) => {
    const data = Buffer.concat([
      Buffer.alloc(fixedFieldsSize),
      encodeKeyValues({ appinfo: keyValues }, stringTable),
    ]);

    return Buffer.concat([uint32(appId), uint32(data.length), data]);
  });

  const headerSize = isV41 ? 16 : 8;
  const body = Buffer.concat([...entries, uint32(0)]);
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(1, 4);

  if (!stringTable) return Buffer.concat([header, body]);

  header.writeBigInt64LE(BigInt(headerSize + body.length), 8);

  return Buffer.concat([
    header,
    body,
    uint32(stringTable.length),
    ...stringTable.map(cString),
  ]);
};

const launch = (
  entries: {
    executable: string;
    type?: string;
    oslist?: string;
    osarch?: string;
    betakey?: string;
  }[]
): TestKeyValues =>
  Object.fromEntries(
    entries.map((entry, index) => {
      const config: TestKeyValues = {};
      if (entry.oslist) config.oslist = entry.oslist;
      if (entry.osarch) config.osarch = entry.osarch;
      if (entry.betakey) config.betakey = entry.betakey;

      const value: TestKeyValues = { executable: entry.executable };
      if (entry.type) value.type = entry.type;
      if (Object.keys(config).length > 0) value.config = config;

      return [String(index), value];
    })
  );

const sampleApps: { appId: number; keyValues: TestKeyValues }[] = [
  {
    appId: 10,
    keyValues: {
      appid: 10,
      common: { name: "Counter-Strike", type: "Game" },
      config: { launch: launch([{ executable: "hl.exe", type: "default" }]) },
    },
  },
  {
    appId: 620,
    keyValues: {
      appid: 620,
      common: { name: "Portal 2", type: "Game" },
      config: {
        launch: launch([
          { executable: "portal2.sh", oslist: "linux" },
          { executable: "portal2.exe", oslist: "windows" },
        ]),
      },
    },
  },
  {
    appId: 1070560,
    keyValues: {
      appid: 1070560,
      common: { name: "Steam Linux Runtime", type: "Tool" },
      config: {},
    },
  },
];

const writeTempFile = async (buffer: Buffer) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-steam-appinfo-")
  );
  const filePath = path.join(directory, "appinfo.vdf");
  await fs.promises.writeFile(filePath, buffer);
  return { directory, filePath };
};

const makeAppInfo = (entries: Partial<SteamLaunchEntry>[]): SteamAppInfo => ({
  appId: "1",
  type: "game",
  name: "Game",
  launch: entries.map((entry) => ({
    executable: "game.exe",
    arguments: null,
    type: null,
    oslist: [],
    osarch: null,
    betakey: null,
    ...entry,
  })),
});

describe("readSteamAppInfo", () => {
  for (const [version, magic] of [
    ["v39", STEAM_APP_INFO_MAGIC_V39],
    ["v40", STEAM_APP_INFO_MAGIC_V40],
    ["v41", STEAM_APP_INFO_MAGIC_V41],
  ] as const) {
    it(`reads only the requested apps from ${version} files`, async (t) => {
      const { directory, filePath } = await writeTempFile(
        buildAppInfoFile(magic, sampleApps)
      );
      t.after(() =>
        fs.promises.rm(directory, { recursive: true, force: true })
      );

      const appInfos = await readSteamAppInfo(filePath, ["620", "1070560"]);

      assert.deepEqual([...appInfos.keys()], ["620", "1070560"]);
      assert.deepEqual(appInfos.get("620"), {
        appId: "620",
        type: "game",
        name: "Portal 2",
        launch: [
          {
            executable: "portal2.sh",
            arguments: null,
            type: null,
            oslist: ["linux"],
            osarch: null,
            betakey: null,
          },
          {
            executable: "portal2.exe",
            arguments: null,
            type: null,
            oslist: ["windows"],
            osarch: null,
            betakey: null,
          },
        ],
      });
      assert.equal(appInfos.get("1070560")?.type, "tool");
      assert.deepEqual(appInfos.get("1070560")?.launch, []);
    });
  }

  it("rejects unknown file versions", async (t) => {
    const { directory, filePath } = await writeTempFile(
      buildAppInfoFile(0x07564426, sampleApps)
    );
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

    await assert.rejects(readSteamAppInfo(filePath, ["10"]));
  });
});

describe("parseBinaryKeyValues", () => {
  it("reads every value type", () => {
    const wide = Buffer.concat([
      Buffer.from("Wide", "utf16le"),
      Buffer.alloc(2),
    ]);
    const float = Buffer.alloc(4);
    float.writeFloatLE(1.5);
    const uint64 = Buffer.alloc(8);
    uint64.writeBigUInt64LE(2n ** 40n);
    const int64 = Buffer.alloc(8);
    int64.writeBigInt64LE(-5n);

    const buffer = Buffer.concat([
      Buffer.from([0x05]),
      cString("wide"),
      wide,
      Buffer.from([0x03]),
      cString("float"),
      float,
      Buffer.from([0x06]),
      cString("color"),
      int32(255),
      Buffer.from([0x07]),
      cString("uint64"),
      uint64,
      Buffer.from([0x0a]),
      cString("int64"),
      int64,
      Buffer.from([0x00]),
      cString("nested"),
      Buffer.from([0x01]),
      cString("name"),
      cString("value"),
      Buffer.from([0x0b]),
      Buffer.from([0x08]),
    ]);

    assert.deepEqual(parseBinaryKeyValues(buffer), {
      wide: "Wide",
      float: 1.5,
      color: 255,
      uint64: 2n ** 40n,
      int64: -5n,
      nested: { name: "value" },
    });
  });

  it("fails on unknown value types", () => {
    assert.throws(() =>
      parseBinaryKeyValues(
        Buffer.concat([Buffer.from([0x09]), cString("x"), Buffer.from([0x08])])
      )
    );
  });
});

describe("selectSteamLaunchCandidates", () => {
  it("prefers the default Windows entry and skips servers, editors and URLs", () => {
    const appInfo = makeAppInfo([
      { executable: "server.exe", type: "server" },
      { executable: "editor.exe", type: "editor" },
      { executable: "steam://open/games" },
      { executable: "option.exe", type: "option1" },
      { executable: "game.exe", type: "default", oslist: ["windows"] },
      { executable: "game.sh", oslist: ["linux"] },
    ]);

    assert.deepEqual(
      selectSteamLaunchCandidates(appInfo, "win32", "x64").map(
        (entry) => entry.executable
      ),
      ["game.exe", "option.exe"]
    );
  });

  it("prefers native Linux entries and falls back to Windows for Proton", () => {
    const appInfo = makeAppInfo([
      { executable: "Game.exe", oslist: ["windows"] },
      { executable: "game.x86_64", oslist: ["linux"] },
    ]);

    assert.deepEqual(
      selectSteamLaunchCandidates(appInfo, "linux", "x64").map(
        (entry) => entry.executable
      ),
      ["game.x86_64", "Game.exe"]
    );
    assert.deepEqual(
      selectSteamLaunchCandidates(
        makeAppInfo([{ executable: "Game.exe", oslist: ["windows"] }]),
        "linux",
        "x64"
      ).map((entry) => entry.executable),
      ["Game.exe"]
    );
  });

  it("ranks beta branches and 32-bit builds after the regular 64-bit launch", () => {
    const appInfo = makeAppInfo([
      { executable: "beta.exe", betakey: "beta" },
      { executable: "game32.exe", osarch: "32" },
      { executable: "game64.exe", osarch: "64" },
    ]);

    assert.deepEqual(
      selectSteamLaunchCandidates(appInfo, "win32", "x64").map(
        (entry) => entry.executable
      ),
      ["game64.exe", "game32.exe", "beta.exe"]
    );
    assert.deepEqual(
      selectSteamLaunchCandidates(appInfo, "win32", "ia32").map(
        (entry) => entry.executable
      ),
      ["game32.exe", "beta.exe"]
    );
  });

  it("splits executables on either separator", () => {
    assert.deepEqual(toSteamExecutableSegments(".\\bin\\win64/Game.exe"), [
      "bin",
      "win64",
      "Game.exe",
    ]);
  });
});

describe("resolveSteamAppExecutable", () => {
  it("returns the first launch entry that exists, matching case on case-sensitive systems", async (t) => {
    const installDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-steam-game-")
    );
    t.after(() =>
      fs.promises.rm(installDirectory, { recursive: true, force: true })
    );

    await fs.promises.mkdir(path.join(installDirectory, "Bin", "Win64"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(installDirectory, "Bin", "Win64", "Game.exe"),
      ""
    );

    const executablePath = await resolveSteamAppExecutable(
      makeAppInfo([
        { executable: "missing.exe", type: "default" },
        { executable: "bin\\win64\\GAME.exe", type: "option1" },
      ]),
      installDirectory,
      process.platform === "win32" ? "win32" : "linux",
      "x64"
    );

    assert.ok(executablePath);
    assert.equal(
      path.relative(installDirectory, executablePath).toLowerCase(),
      path.join("bin", "win64", "game.exe")
    );
    assert.ok(fs.existsSync(executablePath));
  });

  it("never leaves the install directory", async (t) => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-steam-escape-")
    );
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));

    const installDirectory = path.join(root, "Game");
    await fs.promises.mkdir(installDirectory);
    await fs.promises.writeFile(path.join(root, "outside.exe"), "");

    assert.equal(
      await resolveSteamAppExecutable(
        makeAppInfo([{ executable: "..\\outside.exe" }]),
        installDirectory,
        process.platform,
        "x64"
      ),
      null
    );
  });
});
