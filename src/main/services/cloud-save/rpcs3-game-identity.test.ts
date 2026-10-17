import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  assertRpcs3SnapshotIdentity,
  inspectRpcs3DiscIdentity,
  rpcs3TitleIdsFromCatalogue,
} from "./rpcs3-game-identity-policy.js";

const game = (discs: Array<{ path: string; sku: string | null }>) =>
  ({ discs }) as Game;
const ids = new Set(["BLUS30443", "BLES00510"]);

describe("RPCS3 game identity", () => {
  it("allows the MK savedata alias without authorizing its disc or savestate", async () => {
    const mkIds = new Set(["BLUS30902"]);
    const savedata = {
      rawPath: "<emulator>/rpcs3/BLUS30522/00000001",
      relativePath: "BLUS30522MK9PSET/DATA.BIN",
    };
    assert.doesNotThrow(() => assertRpcs3SnapshotIdentity([savedata], mkIds));
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [
            {
              rawPath: "<emulator>/rpcs3-state/BLUS30522",
              relativePath: "BLUS30522_1_0.SAVESTAT",
            },
          ],
          mkIds
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
    assert.equal(
      (
        await inspectRpcs3DiscIdentity(
          game([{ path: "/games/mk-original", sku: "BLUS30522" }]),
          mkIds,
          async () => "BLUS30522"
        )
      ).status,
      "mismatch"
    );
    assert.throws(
      () => assertRpcs3SnapshotIdentity([savedata], ids),
      /cloud_save_rpcs3_save_wrong_game/
    );
  });

  it("accepts only the game's own game data profile folders", () => {
    const lbpIds = new Set(["BCUS98245"]);
    const rawPath = "<emulator>/rpcs3-gamedata/BCUS98245";
    assert.doesNotThrow(() =>
      assertRpcs3SnapshotIdentity(
        [{ rawPath, relativePath: "BCUS98245_USER1/USRDIR/bigfart2" }],
        lbpIds
      )
    );
    for (const relativePath of [
      "BCUS98245/USRDIR/data.farc",
      "BCUS98245_INSTALL/USRDIR/install.bin",
      "BCES00850_USER1/USRDIR/bigfart2",
      "BCUS98245_USER1",
    ]) {
      assert.throws(
        () => assertRpcs3SnapshotIdentity([{ rawPath, relativePath }], lbpIds),
        /cloud_save_rpcs3_save_wrong_game/,
        relativePath
      );
    }
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [
            {
              rawPath: "<emulator>/rpcs3-gamedata/BCES00850",
              relativePath: "BCES00850_USER1/USRDIR/bigfart2",
            },
          ],
          lbpIds
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
    const profilePath = "/rpcs3/dev_hdd0/game/BCUS98245_USER1";
    const customRawPath = `<custom><mac><home>${profilePath}`;
    assert.doesNotThrow(() =>
      assertRpcs3SnapshotIdentity(
        [{ rawPath: customRawPath, relativePath: "USRDIR/bigfart2" }],
        lbpIds,
        [
          {
            rawPath: customRawPath,
            path: profilePath,
            platform: "mac" as const,
            kind: "dir" as const,
          },
        ]
      )
    );
  });

  it("keeps savedata aliases valid for custom paths without laundering savestates", () => {
    const mkIds = new Set(["BLUS30902"]);
    const savePath = "/rpcs3/dev_hdd0/home/00000001/savedata/BLUS30522MK9PSET";
    const rawPath = `<custom><mac><home>${savePath}`;
    const binding = {
      rawPath,
      path: savePath,
      platform: "mac" as const,
      kind: "dir" as const,
    };
    assert.doesNotThrow(() =>
      assertRpcs3SnapshotIdentity(
        [{ rawPath, relativePath: "DATA.BIN" }],
        mkIds,
        [binding]
      )
    );
    const statePath = "/rpcs3/savestates/BLUS30522";
    const stateRawPath = `<custom><mac><home>${statePath}`;
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [{ rawPath: stateRawPath, relativePath: "BLUS30522_1_0.SAVESTAT" }],
          mkIds,
          [{ ...binding, rawPath: stateRawPath, path: statePath }]
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [{ rawPath, relativePath: "BLUS30522_1_0.SAVESTAT" }],
          mkIds,
          [{ ...binding, path: statePath }]
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
  });

  it("uses only IDs from the matching catalogue page", () => {
    const entries = [
      { objectId: "gow", shop: "launchbox", skus: ["BLUS-30443", "BLES00510"] },
      { objectId: "minecraft", shop: "launchbox", skus: ["NPUB31419"] },
    ];
    assert.deepEqual(rpcs3TitleIdsFromCatalogue(entries, "gow"), ids);
    assert.equal(rpcs3TitleIdsFromCatalogue(entries, "unknown").size, 0);
    assert.equal(
      rpcs3TitleIdsFromCatalogue(
        [{ objectId: "gow", shop: "steam", skus: ["NPUB31419"] }],
        "gow"
      ).size,
      0
    );
  });
  it("rejects Minecraft media on the God of War page", async () => {
    const result = await inspectRpcs3DiscIdentity(
      game([{ path: "/games/minecraft", sku: "NPUB31419" }]),
      ids,
      async () => "NPUB31419"
    );
    assert.deepEqual(result, {
      status: "mismatch",
      path: "/games/minecraft",
      titleId: "NPUB31419",
    });
  });

  it("checks all discs without relying on the selected disc", async () => {
    const result = await inspectRpcs3DiscIdentity(
      game([
        { path: "/games/gow", sku: "BLUS30443" },
        { path: "/games/minecraft", sku: "NPUB31419" },
      ]),
      ids,
      async (filePath) => (filePath.endsWith("gow") ? "BLUS30443" : "NPUB31419")
    );
    assert.equal(result.status, "mismatch");
    assert.equal(result.path, "/games/minecraft");
  });

  it("accepts matching regional IDs and rejects stale or unreadable media", async () => {
    assert.equal(
      (
        await inspectRpcs3DiscIdentity(
          game([{ path: "/games/gow", sku: "BLES-00510" }]),
          ids,
          async () => "BLES00510"
        )
      ).status,
      "ready"
    );
    assert.equal(
      (
        await inspectRpcs3DiscIdentity(
          game([{ path: "/games/gow", sku: "NPUB31419" }]),
          ids,
          async () => "BLUS30443"
        )
      ).status,
      "stale-sku"
    );
    assert.equal(
      (
        await inspectRpcs3DiscIdentity(
          game([{ path: "/games/BLUS30443.iso", sku: "BLUS30443" }]),
          ids,
          async () => null
        )
      ).status,
      "unverified"
    );
    assert.equal(
      (await inspectRpcs3DiscIdentity(game([]), ids, async () => null)).status,
      "missing"
    );
  });

  it("blocks foreign and unverifiable remote files before restore or deletion", () => {
    const valid = {
      rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
      relativePath: "BLUS30443-SLOT01/GAMEDATA",
    };
    assert.doesNotThrow(() => assertRpcs3SnapshotIdentity([valid], ids));
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [{ ...valid, rawPath: "<emulator>/rpcs3/NPUB31419/00000001" }],
          ids
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [{ rawPath: "<custom>/old", relativePath: "GAMEDATA" }],
          ids
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
    assert.doesNotThrow(() =>
      assertRpcs3SnapshotIdentity(
        [
          {
            rawPath: "<emulator>/rpcs3-state/BLUS30443",
            relativePath: "BLUS30443_1_2.SAVESTAT.zst",
          },
        ],
        ids
      )
    );
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [
            {
              rawPath: "<emulator>/rpcs3-state/NPUB31419",
              relativePath: "NPUB31419_1_2.SAVESTAT.zst",
            },
          ],
          ids
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
  });

  it("keeps a bound custom save for this game but blocks foreign bindings", () => {
    const file = {
      rawPath:
        "<custom><mac><home>/rpcs3/dev_hdd0/home/00000001/savedata/BLUS30443-SLOT01",
      relativePath: "GAMEDATA",
    };
    const binding = {
      rawPath: file.rawPath,
      path: "/rpcs3/dev_hdd0/home/00000001/savedata/BLUS30443-SLOT01",
      platform: "mac" as const,
      kind: "dir" as const,
    };
    assert.doesNotThrow(() =>
      assertRpcs3SnapshotIdentity([file], ids, [binding])
    );
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity([file], ids, [
          {
            ...binding,
            path: "/rpcs3/dev_hdd0/home/00000001/savedata/NPUB31419-SLOT01",
          },
        ]),
      /cloud_save_rpcs3_save_wrong_game/
    );
    assert.throws(
      () =>
        assertRpcs3SnapshotIdentity(
          [
            {
              ...file,
              rawPath:
                "<custom><mac><home>/rpcs3/dev_hdd0/home/00000001/savedata/NPUB31419-SLOT01",
            },
          ],
          ids,
          [
            {
              ...binding,
              rawPath:
                "<custom><mac><home>/rpcs3/dev_hdd0/home/00000001/savedata/NPUB31419-SLOT01",
            },
          ]
        ),
      /cloud_save_rpcs3_save_wrong_game/
    );
  });
});
