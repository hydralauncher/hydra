import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Game } from "@types";

import {
  parseShadps4SaveRawPath,
  shadps4SaveRawPath,
} from "./emulator-provider-identity.js";
import {
  assertShadps4SnapshotIdentity,
  inspectShadps4DiscIdentity,
} from "./shadps4-game-identity.js";
import {
  getShadps4SavedataTitleIds,
  isShadps4GameSaveFile,
  readShadps4DiscIds,
  withShadps4OtherVersionIds,
} from "./shadps4-save-layout.js";
import { scanShadps4SaveRoot } from "./shadps4-save-scanner.js";
import { resolveShadps4SavedataRestoreRule } from "./shadps4-savedata-restore.js";

const paramSfo = (entries: Record<string, string>) => {
  const keys = Object.keys(entries);
  const keyTable = Buffer.from(keys.map((key) => `${key}\0`).join(""), "ascii");
  const values = keys.map((key) => Buffer.from(`${entries[key]}\0`, "ascii"));
  const keyTableStart = 20 + keys.length * 16;
  const dataTableStart = keyTableStart + keyTable.length;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46535000, 0);
  header.writeUInt32LE(0x0101, 4);
  header.writeUInt32LE(keyTableStart, 8);
  header.writeUInt32LE(dataTableStart, 12);
  header.writeUInt32LE(keys.length, 16);
  const index = Buffer.alloc(keys.length * 16);
  let keyOffset = 0;
  let dataOffset = 0;
  keys.forEach((key, i) => {
    index.writeUInt16LE(keyOffset, i * 16);
    index.writeUInt16LE(0x0204, i * 16 + 2);
    index.writeUInt32LE(values[i].length, i * 16 + 4);
    index.writeUInt32LE(values[i].length, i * 16 + 8);
    index.writeUInt32LE(dataOffset, i * 16 + 12);
    keyOffset += key.length + 1;
    dataOffset += values[i].length;
  });
  return Buffer.concat([header, index, keyTable, ...values]);
};

let root: string;

const writeFile = async (target: string, content: string | Buffer = "x") => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};

const makeDisc = async (name: string, entries: Record<string, string>) => {
  const discPath = path.join(root, "games", name);
  await writeFile(path.join(discPath, "eboot.bin"));
  await writeFile(
    path.join(discPath, "sce_sys", "param.sfo"),
    paramSfo(entries)
  );
  return discPath;
};

const game = (discs: Array<{ path: string; sku?: string }>) =>
  ({
    shop: "launchbox",
    objectId: "ps4-game",
    platform: "Sony Playstation 4",
    discs: discs.map((disc) => ({
      ...disc,
      label: path.basename(disc.path),
      fileName: path.basename(disc.path),
    })),
  }) as unknown as Game;

describe("shadPS4 saves", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-shadps4-saves-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads the save folder from INSTALL_DIR_SAVEDATA, then the serial", async () => {
    const bloodborne = await makeDisc("CUSA03173", {
      TITLE_ID: "CUSA03173",
      CONTENT_ID: "EP9000-CUSA03173_00-BLOODBORNEGOTY00",
      INSTALL_DIR_SAVEDATA: "CUSA00207",
    });
    assert.deepEqual(await readShadps4DiscIds(bloodborne), {
      titleId: "CUSA03173",
      saveTitleId: "CUSA00207",
    });

    const fromContentId = await makeDisc("content", {
      TITLE_ID: "CUSA11111",
      CONTENT_ID: "UP0001-CUSA22222_00-SOMEGAME00000000",
    });
    assert.equal(
      (await readShadps4DiscIds(fromContentId))?.saveTitleId,
      "CUSA22222"
    );

    const titleOnly = await makeDisc("title", { TITLE_ID: "CUSA33333" });
    assert.equal(
      (await readShadps4DiscIds(titleOnly))?.saveTitleId,
      "CUSA33333"
    );

    assert.equal(await readShadps4DiscIds(path.join(root, "nope")), null);
  });

  it("reports disc identity from the game's own param.sfo", async () => {
    const disc = await makeDisc("CUSA03173", {
      TITLE_ID: "CUSA03173",
      INSTALL_DIR_SAVEDATA: "CUSA00207",
    });

    assert.equal(
      (await inspectShadps4DiscIdentity(game([]))).status.status,
      "missing"
    );
    assert.deepEqual(
      await inspectShadps4DiscIdentity(
        game([{ path: disc, sku: "CUSA-03173" }])
      ),
      {
        status: { status: "ready", path: null, titleId: null },
        saveTitleIds: ["CUSA00207"],
      }
    );
    assert.equal(
      (
        await inspectShadps4DiscIdentity(
          game([{ path: disc, sku: "CUSA-99999" }])
        )
      ).status.status,
      "stale-sku"
    );
    assert.equal(
      (
        await inspectShadps4DiscIdentity(
          game([{ path: path.join(root, "gone"), sku: "CUSA-03173" }])
        )
      ).status.status,
      "unverified"
    );
    assert.deepEqual(
      await getShadps4SavedataTitleIds(game([{ path: disc }]), async () => []),
      ["CUSA00207"]
    );
  });

  it("keeps the saves of the game's other versions", async () => {
    const disc = path.join(root, "CUSA14876");
    await fs.mkdir(path.join(disc, "sce_sys"), { recursive: true });
    await fs.writeFile(
      path.join(disc, "sce_sys", "param.sfo"),
      paramSfo({ TITLE_ID: "CUSA14876" })
    );
    const versions = async () => ["CUSA-13795", "CUSA14876", "not-an-id"];

    assert.deepEqual(
      await getShadps4SavedataTitleIds(game([{ path: disc }]), versions),
      ["CUSA13795", "CUSA14876"]
    );
    // Without a game set, there is nothing to sync.
    assert.deepEqual(await getShadps4SavedataTitleIds(game([]), versions), []);
    assert.deepEqual(
      await withShadps4OtherVersionIds(game([]), [], versions),
      []
    );
  });

  it("accepts only this game's saves in a snapshot", () => {
    const allowed = new Set(["CUSA00207"]);
    const ok = {
      rawPath: shadps4SaveRawPath("CUSA00207", "1000"),
      relativePath: "SPRJ0005/userdata0000",
    };
    assert.doesNotThrow(() => assertShadps4SnapshotIdentity([ok], allowed));
    for (const bad of [
      { ...ok, rawPath: shadps4SaveRawPath("CUSA99999", "1000") },
      { ...ok, relativePath: "sce_bu_SPRJ0005/userdata0000" },
      { ...ok, relativePath: "SPRJ0005/sce_sys/corrupted" },
      { ...ok, relativePath: "userdata0000" },
      { ...ok, relativePath: "../SPRJ0005/userdata0000" },
    ]) {
      assert.throws(
        () => assertShadps4SnapshotIdentity([bad], allowed),
        /cloud_save_shadps4_save_wrong_game/
      );
    }
    assert.deepEqual(parseShadps4SaveRawPath(ok.rawPath), {
      saveTitleId: "CUSA00207",
      userId: "1000",
    });
  });

  it("matches custom paths that point inside one of the game's saves", () => {
    const save = path.join(root, "home", "1000", "savedata", "CUSA00207");
    assert.equal(
      isShadps4GameSaveFile(path.join(save, "SPRJ0005", "userdata0000"), [
        "CUSA00207",
      ]),
      true
    );
    assert.equal(
      isShadps4GameSaveFile(
        path.join(save, "sce_bu_SPRJ0005", "userdata0000"),
        ["CUSA00207"]
      ),
      false
    );
    assert.equal(
      isShadps4GameSaveFile(path.join(save, "SPRJ0005", "userdata0000"), [
        "CUSA11111",
      ]),
      false
    );
  });

  it("scans every user and skips backups and the mount marker", async () => {
    const home = path.join(root, "home");
    const title = (user: string) =>
      path.join(home, user, "savedata", "CUSA00207");
    await writeFile(path.join(title("1000"), "SPRJ0005", "userdata0000"));
    await writeFile(
      path.join(title("1000"), "SPRJ0005", "sce_sys", "param.sfo")
    );
    await writeFile(
      path.join(title("1000"), "SPRJ0005", "sce_sys", "corrupted")
    );
    await writeFile(
      path.join(title("1000"), "sce_bu_SPRJ0005", "userdata0000")
    );
    await writeFile(path.join(title("1001"), "SPRJ0005", "userdata0000"));
    await writeFile(path.join(home, "1000", "trophy", "data.xml"));
    await writeFile(
      path.join(home, "1000", "savedata", "CUSA99999", "X", "data")
    );

    const result = await scanShadps4SaveRoot(
      {
        game: game([]),
        environmentId: "env",
        variantId: "variant",
        savedataTitleIds: ["CUSA00207"],
      },
      home
    );

    assert.deepEqual(
      result.files.map((file) => `${file.rawPath} ${file.relativePath}`).sort(),
      [
        `${shadps4SaveRawPath("CUSA00207", "1000")} SPRJ0005/sce_sys/param.sfo`,
        `${shadps4SaveRawPath("CUSA00207", "1000")} SPRJ0005/userdata0000`,
        `${shadps4SaveRawPath("CUSA00207", "1001")} SPRJ0005/userdata0000`,
      ]
    );
    assert.deepEqual(
      result.coverage.map((entry) => [entry.rawPath, entry.outcome]).sort(),
      [
        [shadps4SaveRawPath("CUSA00207", "1000"), "scanned"],
        [shadps4SaveRawPath("CUSA00207", "1001"), "scanned"],
      ]
    );
  });

  it("marks a user without the game's folder as confirmed missing", async () => {
    const home = path.join(root, "home");
    await fs.mkdir(path.join(home, "1000", "savedata"), { recursive: true });
    const result = await scanShadps4SaveRoot(
      {
        game: game([]),
        environmentId: "env",
        variantId: "variant",
        savedataTitleIds: ["CUSA00207"],
      },
      home
    );
    assert.equal(result.files.length, 0);
    assert.deepEqual(
      result.coverage.map((entry) => entry.outcome),
      ["confirmed-missing"]
    );
  });

  it("restores into the matching user, even one this PC does not have", async () => {
    const home = path.join(root, "home");
    await fs.mkdir(home);
    const allowed = new Set(["CUSA00207"]);
    const file = {
      rawPath: shadps4SaveRawPath("CUSA00207", "1001"),
      relativePath: "SPRJ0005/userdata0000",
    };

    const rule = await resolveShadps4SavedataRestoreRule(file, allowed, home);
    assert.equal(rule?.kind, "dir");
    assert.equal(
      rule?.preferredPath,
      path.join(home, "1001", "savedata", "CUSA00207")
    );

    assert.equal(
      await resolveShadps4SavedataRestoreRule(
        { ...file, rawPath: shadps4SaveRawPath("CUSA99999", "1001") },
        allowed,
        home
      ),
      null
    );
    assert.equal(
      await resolveShadps4SavedataRestoreRule(
        { ...file, relativePath: "SPRJ0005/sce_sys/corrupted" },
        allowed,
        home
      ),
      null
    );
    assert.equal(
      await resolveShadps4SavedataRestoreRule(
        file,
        allowed,
        path.join(root, "missing-home")
      ),
      null
    );
  });

  it("does not follow a linked savedata folder outside the home folder", async () => {
    const home = path.join(root, "home");
    const outside = path.join(root, "outside");
    await writeFile(
      path.join(outside, "CUSA00207", "SPRJ0005", "userdata0000")
    );
    await fs.mkdir(path.join(home, "1000"), { recursive: true });
    await fs.symlink(outside, path.join(home, "1000", "savedata"), "junction");

    const result = await scanShadps4SaveRoot(
      {
        game: game([]),
        environmentId: "env",
        variantId: "variant",
        savedataTitleIds: ["CUSA00207"],
      },
      home
    );

    assert.deepEqual(result.files, []);
    assert.deepEqual(
      result.coverage.map((entry) => [entry.rawPath, entry.outcome]),
      [[shadps4SaveRawPath("CUSA00207", "1000"), "partial"]]
    );
  });

  it("rejects an INSTALL_DIR_SAVEDATA that is not a serial", async () => {
    const disc = await makeDisc("odd", {
      TITLE_ID: "CUSA03173",
      INSTALL_DIR_SAVEDATA: "not-a-serial",
    });
    assert.equal(await readShadps4DiscIds(disc), null);
  });

  it("ignores PC executables and ports registered next to the game folder", async () => {
    const disc = await makeDisc("CUSA03173", {
      TITLE_ID: "CUSA03173",
      INSTALL_DIR_SAVEDATA: "CUSA00207",
    });
    const pcGame = {
      ...game([{ path: disc, sku: "CUSA-03173" }]),
    } as Game;
    pcGame.discs!.push(
      {
        path: path.join(root, "pc", "game.exe"),
        label: "game.exe",
        fileName: "game.exe",
        isExecutable: true,
      },
      {
        path: path.join(root, "ports", "port.exe"),
        label: "port",
        fileName: "port.exe",
        recompilationSlug: "some-port",
      }
    );
    assert.deepEqual(await inspectShadps4DiscIdentity(pcGame), {
      status: { status: "ready", path: null, titleId: null },
      saveTitleIds: ["CUSA00207"],
    });
    assert.deepEqual(await getShadps4SavedataTitleIds(pcGame, async () => []), [
      "CUSA00207",
    ]);
  });

  it("accepts a save folder that is itself named savedata", () => {
    const save = path.join(root, "home", "1000", "savedata", "CUSA00207");
    assert.equal(
      isShadps4GameSaveFile(path.join(save, "SAVEDATA", "userdata0000"), [
        "CUSA00207",
      ]),
      true
    );
    assert.doesNotThrow(() =>
      assertShadps4SnapshotIdentity(
        [
          {
            rawPath: "<custom>/home/1000/savedata/CUSA00207",
            relativePath: "SAVEDATA/userdata0000",
          },
        ],
        new Set(["CUSA00207"]),
        [
          {
            rawPath: "<custom>/home/1000/savedata/CUSA00207",
            kind: "dir",
            path: save,
          } as never,
        ]
      )
    );
  });

  it("keeps coverage complete when a plain file sits next to the saves", async () => {
    const home = path.join(root, "home");
    const title = path.join(home, "1000", "savedata", "CUSA00207");
    await writeFile(path.join(title, "SPRJ0005", "userdata0000"));
    await writeFile(path.join(title, "desktop.ini"));
    const result = await scanShadps4SaveRoot(
      {
        game: game([]),
        environmentId: "env",
        variantId: "variant",
        savedataTitleIds: ["CUSA00207"],
      },
      home
    );
    assert.deepEqual(
      result.files.map((file) => file.relativePath),
      ["SPRJ0005/userdata0000"]
    );
    assert.deepEqual(
      result.coverage.map((entry) => entry.outcome),
      ["scanned"]
    );
  });
});
