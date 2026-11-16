import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import type { ChildProcess } from "node:child_process";

import {
  buildBootFile,
  buildClientConfig,
  buildServerConfig,
  generateAuthenticationKey,
  readIniValue,
  setIniValue,
} from "./config.ts";
import { findGalaxyDlls, toSdkVersion } from "./galaxy-dll.ts";
import {
  getBackupPath,
  getMarkerPath,
  installUniverseLanDll,
  isHydraInstalled,
  restoreGalaxyDll,
} from "./install.ts";
import { readPeVersionInfo } from "./pe-version.ts";
import {
  UniverseLanIntegrityError,
  assertPackageIntegrity,
  selectUniverseLanPackage,
  sha256,
  type GitHubRelease,
} from "./release.ts";
import { UniverseLanServerManager } from "./server.ts";

const createTempDirectory = async (t: TestContext) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ulan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};

const byFile = (a: { file: string }, b: { file: string }) =>
  a.file < b.file ? -1 : 1;

const utf16 = (value: string) => Buffer.from(`${value}\0`, "utf16le");

/** Builds a fake PE file containing a VS_VERSIONINFO resource. */
const buildFakeDll = (
  productName: string | null,
  version: [number, number, number, number],
  filler = "MZ fake binary body "
) => {
  const fixedFileInfo = Buffer.alloc(52);
  fixedFileInfo.writeUInt32LE(0xfeef04bd, 0);
  fixedFileInfo.writeUInt32LE(0x00010000, 4);
  fixedFileInfo.writeUInt32LE(((version[0] << 16) | version[1]) >>> 0, 8);
  fixedFileInfo.writeUInt32LE(((version[2] << 16) | version[3]) >>> 0, 12);

  const parts = [
    Buffer.from(filler.repeat(50), "latin1"),
    Buffer.alloc(6),
    utf16("VS_VERSION_INFO"),
    Buffer.alloc(2),
    fixedFileInfo,
  ];

  if (productName !== null) {
    parts.push(
      Buffer.alloc(6),
      utf16("CompanyName"),
      utf16("Somebody"),
      Buffer.alloc(6),
      utf16("ProductName"),
      Buffer.alloc(2),
      utf16(productName)
    );
  }

  return Buffer.concat([...parts, Buffer.alloc(32)]);
};

describe("readPeVersionInfo", () => {
  it("reads the file version and product name", () => {
    assert.deepEqual(
      readPeVersionInfo(buildFakeDll("GOG Galaxy", [1, 148, 3, 0])),
      { fileVersion: "1.148.3.0", productName: "GOG Galaxy" }
    );
  });

  it("handles files without a version resource or product name", () => {
    assert.deepEqual(readPeVersionInfo(Buffer.from("no resources here")), {
      fileVersion: null,
      productName: null,
    });
    assert.deepEqual(readPeVersionInfo(buildFakeDll(null, [1, 2, 3, 4])), {
      fileVersion: "1.2.3.4",
      productName: null,
    });
  });
});

describe("findGalaxyDlls", () => {
  it("classifies original, UniverseLAN and unknown Galaxy DLLs", async (t) => {
    const root = await createTempDirectory(t);
    const x64 = path.join(root, "Game_Data", "Plugins", "x86_64");
    const x86 = path.join(root, "Game_Data", "Plugins", "x86");
    const other = path.join(root, "other");

    await fs.mkdir(x64, { recursive: true });
    await fs.mkdir(x86, { recursive: true });
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(
      path.join(x64, "Galaxy64.dll"),
      buildFakeDll("GOG Galaxy", [1, 148, 3, 0])
    );
    await fs.writeFile(
      path.join(x86, "Galaxy.dll"),
      buildFakeDll("UniverseLAN Client", [1, 148, 3, 0])
    );
    await fs.writeFile(
      path.join(other, "galaxy64.dll"),
      buildFakeDll("Something Else", [9, 9, 9, 0])
    );
    await fs.writeFile(
      path.join(other, "REDGalaxy64.dll"),
      buildFakeDll("GOG Galaxy", [1, 148, 3, 0])
    );

    const dlls = await findGalaxyDlls([x64, x86, other, x64]);

    assert.deepEqual(
      dlls
        .map(({ filePath, architecture, kind, sdkVersion }) => ({
          file: path.relative(root, filePath),
          architecture,
          kind,
          sdkVersion,
        }))
        .sort(byFile),
      [
        {
          file: path.join("Game_Data", "Plugins", "x86", "Galaxy.dll"),
          architecture: "x86",
          kind: "universe-lan",
          sdkVersion: "1.148.3",
        },
        {
          file: path.join("Game_Data", "Plugins", "x86_64", "Galaxy64.dll"),
          architecture: "x64",
          kind: "gog",
          sdkVersion: "1.148.3",
        },
        {
          file: path.join("other", "galaxy64.dll"),
          architecture: "x64",
          kind: "unknown",
          sdkVersion: "9.9.9",
        },
      ].sort(byFile)
    );
  });

  it("turns file versions into SDK versions", () => {
    assert.equal(toSdkVersion("1.148.3.0"), "1.148.3");
    assert.equal(toSdkVersion("1.152.11"), "1.152.11");
    assert.equal(toSdkVersion("1, 148, 3, 0"), null);
    assert.equal(toSdkVersion(null), null);
  });
});

describe("UniverseLAN config", () => {
  const BOOT_TEMPLATE = [
    "[Authentication]",
    ";   openssl rand -base64 64",
    "Key = upstream-default-key==",
    "",
    "[Interceptor]",
    "OverrideInitKeys = 0",
    "",
  ].join("\r\n");

  it("reads and replaces values without touching similar keys", () => {
    assert.equal(readIniValue(BOOT_TEMPLATE, "Key"), "upstream-default-key==");

    const boot = buildBootFile(BOOT_TEMPLATE, "hydra-key/+=");

    assert.equal(readIniValue(boot, "Key"), "hydra-key/+=");
    assert.equal(readIniValue(boot, "OverrideInitKeys"), "0");
    assert.ok(boot.includes(";   openssl rand -base64 64"));
  });

  it("appends a value that is missing from the template", () => {
    assert.equal(
      setIniValue("[Settings]\nLanguage = english", "EnableConsole", "0"),
      "[Settings]\nLanguage = english\nEnableConsole = 0\n"
    );
  });

  it("disables the console and keeps the server on this machine", () => {
    const client = buildClientConfig(
      "[Settings]\nEnableConsole = 1\nSaveAchievementsAndStats = 0\n[Client]\nServerAddress = 10.0.0.2\nPort = 19486\n[User]\nSignedIn = 0\n"
    );

    assert.equal(readIniValue(client, "EnableConsole"), "0");
    assert.equal(readIniValue(client, "SaveAchievementsAndStats"), "1");
    assert.equal(readIniValue(client, "ServerAddress"), "127.0.0.1");
    assert.equal(readIniValue(client, "SignedIn"), "1");
    assert.equal(readIniValue(client, "Port"), "19486");

    const server = buildServerConfig(
      "[Server]\n; Use:\n;   BindAddress = localhost\nBindAddress = 0.0.0.0\nPort = 19486\n"
    );

    assert.equal(readIniValue(server, "BindAddress"), "127.0.0.1");
    assert.ok(server.includes(";   BindAddress = localhost"));
  });

  it("generates random base64 authentication keys", () => {
    const key = generateAuthenticationKey();

    assert.equal(Buffer.from(key, "base64").length, 64);
    assert.notEqual(key, generateAuthenticationKey());
  });
});

describe("selectUniverseLanPackage", () => {
  const asset = (
    name: string,
    digest: string | null = `sha256:${"a".repeat(64)}`
  ) => ({
    name,
    browser_download_url: `https://github.com/grasmanek94/UniverseLAN/releases/download/x/${name}`,
    digest,
  });

  const releases: GitHubRelease[] = [
    {
      tag_name: "900",
      prerelease: true,
      assets: [asset("UniverseLAN-1.148.3-Build-900-x64_x86.zip")],
    },
    {
      tag_name: "813",
      assets: [
        asset("UniverseLAN-1.148.3-Build-813-x64_x86.zip"),
        asset("UniverseLAN-1.148.14-Build-813-x64_x86.zip"),
      ],
    },
    { tag_name: "808", assets: [] },
    {
      tag_name: "700",
      assets: [asset("UniverseLAN-1.148.3-Build-700-x64_x86.zip")],
    },
    {
      tag_name: "650",
      assets: [asset("UniverseLAN-1.152.1-Build-650-x64_x86.zip", null)],
    },
  ];

  it("picks the newest stable build for the exact SDK version", () => {
    assert.deepEqual(selectUniverseLanPackage(releases, "1.148.3"), {
      sdkVersion: "1.148.3",
      build: "813",
      assetName: "UniverseLAN-1.148.3-Build-813-x64_x86.zip",
      downloadUrl:
        "https://github.com/grasmanek94/UniverseLAN/releases/download/x/UniverseLAN-1.148.3-Build-813-x64_x86.zip",
      sha256: "a".repeat(64),
    });
    assert.equal(
      selectUniverseLanPackage(releases, "1.148.14")?.assetName,
      "UniverseLAN-1.148.14-Build-813-x64_x86.zip"
    );
  });

  it("never falls back to another SDK version or an unverifiable asset", () => {
    assert.equal(selectUniverseLanPackage(releases, "1.148.1"), null);
    assert.equal(selectUniverseLanPackage(releases, "1.152.1"), null);
  });

  it("rejects assets hosted outside the UniverseLAN repository", () => {
    assert.equal(
      selectUniverseLanPackage(
        [
          {
            tag_name: "1",
            assets: [
              {
                ...asset("UniverseLAN-1.148.3-Build-1-x64_x86.zip"),
                browser_download_url: "https://example.com/UniverseLAN.zip",
              },
            ],
          },
        ],
        "1.148.3"
      ),
      null
    );
  });

  it("verifies the downloaded archive against the digest", () => {
    const data = Buffer.from("zip bytes");
    const universeLanPackage = {
      sdkVersion: "1.148.3",
      build: "1",
      assetName: "a.zip",
      downloadUrl: "",
      sha256: sha256(data),
    };

    assert.doesNotThrow(() => assertPackageIntegrity(universeLanPackage, data));
    assert.throws(
      () => assertPackageIntegrity(universeLanPackage, Buffer.from("tampered")),
      UniverseLanIntegrityError
    );
  });
});

describe("installUniverseLanDll / restoreGalaxyDll", () => {
  const setUp = async (t: TestContext) => {
    const root = await createTempDirectory(t);
    const dllPath = path.join(root, "Galaxy64.dll");
    const replacementPath = path.join(root, "package", "Galaxy64.dll");
    const original = buildFakeDll("GOG Galaxy", [1, 148, 3, 0]);
    const replacement = buildFakeDll("UniverseLAN Client", [1, 148, 3, 0]);

    await fs.mkdir(path.dirname(replacementPath), { recursive: true });
    await fs.writeFile(dllPath, original);
    await fs.writeFile(replacementPath, replacement);

    const [dll] = await findGalaxyDlls([root]);

    return { root, dllPath, replacementPath, original, replacement, dll };
  };

  it("backs up the original, installs UniverseLAN and restores it", async (t) => {
    const { dllPath, replacementPath, original, replacement, dll } =
      await setUp(t);

    const marker = await installUniverseLanDll({
      dll,
      replacementPath,
      sdkVersion: "1.148.3",
      build: "813",
    });

    assert.deepEqual(await fs.readFile(dllPath), replacement);
    assert.deepEqual(await fs.readFile(getBackupPath(dllPath)), original);
    assert.equal(marker.originalSha256, sha256(original));
    assert.equal(marker.installedSha256, sha256(replacement));
    assert.equal(await isHydraInstalled(dllPath), true);

    assert.equal(await restoreGalaxyDll(dllPath), "restored");
    assert.deepEqual(await fs.readFile(dllPath), original);
    assert.equal(await isHydraInstalled(dllPath), false);
    await assert.rejects(fs.access(getBackupPath(dllPath)));
    await assert.rejects(fs.access(getMarkerPath(dllPath)));
  });

  it("refuses to replace DLLs that are not the original GOG one", async (t) => {
    const { root, dllPath, replacementPath, replacement } = await setUp(t);

    await fs.writeFile(dllPath, replacement);
    const [dll] = await findGalaxyDlls([root]);

    await assert.rejects(
      installUniverseLanDll({
        dll,
        replacementPath,
        sdkVersion: "1.148.3",
        build: "813",
      })
    );
    await assert.rejects(fs.access(getBackupPath(dllPath)));
  });

  it("keeps a DLL the game replaced and drops the stale backup", async (t) => {
    const { dllPath, replacementPath, dll } = await setUp(t);

    await installUniverseLanDll({
      dll,
      replacementPath,
      sdkVersion: "1.148.3",
      build: "813",
    });

    const updatedByGame = buildFakeDll("GOG Galaxy", [1, 152, 1, 0]);
    await fs.writeFile(dllPath, updatedByGame);

    assert.equal(await isHydraInstalled(dllPath), false);
    assert.equal(await restoreGalaxyDll(dllPath), "replaced-by-game");
    assert.deepEqual(await fs.readFile(dllPath), updatedByGame);
    await assert.rejects(fs.access(getBackupPath(dllPath)));
  });

  it("does nothing for DLLs Hydra never installed", async (t) => {
    const { dllPath, original } = await setUp(t);

    assert.equal(await restoreGalaxyDll(dllPath), "not-installed");
    assert.deepEqual(await fs.readFile(dllPath), original);
  });
});

describe("UniverseLanServerManager", () => {
  const createFakeSpawn = () => {
    const spawned: Array<{
      executablePath: string;
      cwd: string;
      child: ChildProcess & { killed: boolean };
    }> = [];

    const spawn = (executablePath: string, cwd: string) => {
      const fake = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        killed: false,
        kill: () => {
          fake.killed = true;
          fake.exitCode = 0;
          fake.emit("exit", 0);
          return true;
        },
      });
      const child = fake as unknown as ChildProcess & { killed: boolean };

      spawned.push({ executablePath, cwd, child });
      return child;
    };

    return { spawn, spawned };
  };

  it("runs one server while any game holds it", () => {
    const { spawn, spawned } = createFakeSpawn();
    const manager = new UniverseLanServerManager(spawn);
    const server = path.join("cache", "1.148.3", "UniverseLANServer64.exe");

    manager.acquire("game-a", server);
    manager.acquire("game-b", server);

    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].cwd, path.dirname(server));

    manager.release("game-a");
    assert.equal(manager.isRunning, true);

    manager.release("game-b");
    assert.equal(manager.isRunning, false);
    assert.equal(spawned[0].child.killed, true);
  });

  it("replaces the server when another SDK version is needed", () => {
    const { spawn, spawned } = createFakeSpawn();
    const manager = new UniverseLanServerManager(spawn);

    manager.acquire("game-a", "a/UniverseLANServer64.exe");
    manager.acquire("game-b", "b/UniverseLANServer64.exe");

    assert.equal(spawned.length, 2);
    assert.equal(spawned[0].child.killed, true);
    assert.equal(manager.runningExecutablePath, "b/UniverseLANServer64.exe");

    manager.stopAll();
    assert.equal(spawned[1].child.killed, true);
  });

  it("restarts the server if it exited on its own", () => {
    const { spawn, spawned } = createFakeSpawn();
    const manager = new UniverseLanServerManager(spawn);

    manager.acquire("game-a", "a/UniverseLANServer64.exe");
    spawned[0].child.emit("exit", 1);
    assert.equal(manager.isRunning, false);

    manager.acquire("game-a", "a/UniverseLANServer64.exe");
    assert.equal(spawned.length, 2);
  });

  it("ignores releases from games that never acquired the server", () => {
    const { spawn } = createFakeSpawn();
    const manager = new UniverseLanServerManager(spawn);

    manager.acquire("game-a", "a/UniverseLANServer64.exe");
    manager.release("unknown-game");

    assert.equal(manager.isRunning, true);
  });
});
