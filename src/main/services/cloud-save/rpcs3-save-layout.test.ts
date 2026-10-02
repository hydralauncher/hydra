import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  isRpcs3GameSaveFile,
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
  rpcs3SavestateFileBelongsToTitle,
  rpcs3SlotBelongsToTitle,
  rpcs3TitleIdsForGame,
} from "./rpcs3-save-layout.js";

describe("RPCS3 save layout", () => {
  it("reads the active RPCS3 user and rejects a broken user setting", () => {
    assert.equal(parseRpcs3ActiveProfileId(null), "00000001");
    assert.equal(
      parseRpcs3ActiveProfileId("[Playtime]\nGAME=100\n"),
      "00000001"
    );
    assert.equal(
      parseRpcs3ActiveProfileId(
        "[Playtime]\nactive_user=00000009\n[Users]\nactive_user=00000002\n"
      ),
      "00000002"
    );
    assert.equal(
      parseRpcs3ActiveProfileId("[Users]\nactive_user=00000000\n"),
      null
    );
    assert.equal(
      parseRpcs3ActiveProfileId("[Users]\nactive_user=../../other\n"),
      null
    );
  });

  it("normalizes disc SKUs and matches only its Title ID prefix", () => {
    const game = {
      discs: [{ sku: "BLUS-30443" }, { sku: "blus30443" }, { sku: "BLUS3044" }],
    } as Game;
    assert.deepEqual(rpcs3TitleIdsForGame(game), ["BLUS30443"]);
    assert.equal(
      rpcs3SlotBelongsToTitle("BLUS30443-SLOT01", "BLUS30443"),
      true
    );
    assert.equal(
      rpcs3SlotBelongsToTitle("OTHER-BLUS30443", "BLUS30443"),
      false
    );
  });

  it("recognizes RPCS3 states and filters manually selected files by game", () => {
    const game = { discs: [{ sku: "BLUS30443" }] } as Game;
    assert.equal(
      rpcs3SavestateFileBelongsToTitle(
        "BLUS30443_1_2.SAVESTAT.zst",
        "BLUS30443"
      ),
      true
    );
    assert.equal(
      rpcs3SavestateFileBelongsToTitle("BLUS30443_old.SAVESTAT", "BLUS30443"),
      false
    );
    assert.equal(
      isRpcs3GameSaveFile(
        game,
        path.join(
          "/",
          "rpcs3",
          "savestates",
          "BLUS30443",
          "BLUS30443_1_2.SAVESTAT.zst"
        )
      ),
      true
    );
    assert.equal(
      isRpcs3GameSaveFile(
        game,
        path.join(
          "/",
          "rpcs3",
          "savestates",
          "BLES99999",
          "BLES99999_1_2.SAVESTAT.zst"
        )
      ),
      false
    );
    assert.equal(
      isRpcs3GameSaveFile(
        game,
        path.join("/", "rpcs3", "savedata", "BLUS30443-SLOT01", "DATA.BIN")
      ),
      true
    );
    assert.equal(
      isRpcs3GameSaveFile(
        game,
        path.join("/", "rpcs3", "savedata", "BLES99999-SLOT01", "DATA.BIN")
      ),
      false
    );
  });

  it("resolves the default and custom VFS mounts", () => {
    const root = path.join(path.sep, "rpcs3", "config");
    assert.equal(resolveRpcs3VfsHdd0(root, null), path.join(root, "dev_hdd0"));
    assert.equal(
      resolveRpcs3VfsHdd0(
        root,
        `"$(EmulatorDir)": "${path.join(path.sep, "rpcs3", "portable")}/"\n"/dev_hdd0/": "$(EmulatorDir)hdd/"\n`
      ),
      path.join(path.sep, "rpcs3", "portable", "hdd")
    );
    assert.throws(
      () =>
        resolveRpcs3VfsHdd0(
          root,
          '"$(EmulatorDir)": "../portable/"\n"/dev_hdd0/": "$(EmulatorDir)hdd/"\n'
        ),
      /cloud_save_rpcs3_vfs_unresolved/
    );
    assert.throws(
      () => resolveRpcs3VfsHdd0(root, '"/dev_hdd0/": "relative/hdd"'),
      /cloud_save_rpcs3_vfs_unresolved/
    );
    assert.throws(
      () => resolveRpcs3VfsHdd0(root, '"/dev_hdd0/": "$(Unknown)hdd/"'),
      /cloud_save_rpcs3_vfs_unresolved/
    );
  });
});
