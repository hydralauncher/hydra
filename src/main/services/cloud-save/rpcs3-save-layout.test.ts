import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
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
