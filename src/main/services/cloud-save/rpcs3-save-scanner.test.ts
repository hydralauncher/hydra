import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  scanRpcs3Gamedata,
  scanRpcs3SaveRoot,
  scanRpcs3Savestates,
} from "./rpcs3-save-scanner.js";

const paramSfo = (entries: Record<string, string>) => {
  const keys = Object.keys(entries);
  const keyTable = Buffer.from(keys.map((key) => `${key}\0`).join(""), "ascii");
  const values = keys.map((key) => Buffer.from(`${entries[key]}\0`, "ascii"));
  const keyTableStart = 20 + keys.length * 16;
  const dataTableStart = keyTableStart + keyTable.length;
  const dataTable = Buffer.concat(values);
  const sfo = Buffer.alloc(dataTableStart + dataTable.length);
  sfo.writeUInt32LE(0x46535000, 0);
  sfo.writeUInt32LE(0x0101, 4);
  sfo.writeUInt32LE(keyTableStart, 8);
  sfo.writeUInt32LE(dataTableStart, 12);
  sfo.writeUInt32LE(keys.length, 16);
  let keyOffset = 0;
  let dataOffset = 0;
  keys.forEach((key, index) => {
    const offset = 20 + index * 16;
    sfo.writeUInt16LE(keyOffset, offset);
    sfo.writeUInt16LE(0x0204, offset + 2);
    sfo.writeUInt32LE(values[index].length, offset + 4);
    sfo.writeUInt32LE(values[index].length, offset + 8);
    sfo.writeUInt32LE(dataOffset, offset + 12);
    keyOffset += key.length + 1;
    dataOffset += values[index].length;
  });
  keyTable.copy(sfo, keyTableStart);
  dataTable.copy(sfo, dataTableStart);
  return sfo;
};

const writeGamedataFolder = async (
  gameRoot: string,
  folderName: string,
  sfo: Record<string, string>,
  files: Record<string, string> = {}
) => {
  const folderRoot = path.join(gameRoot, folderName);
  await fs.mkdir(folderRoot, { recursive: true });
  await fs.writeFile(path.join(folderRoot, "PARAM.SFO"), paramSfo(sfo));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(folderRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return folderRoot;
};

describe("RPCS3 Cloud Save scanner", () => {
  const game = {
    discs: [{ sku: "BLUS30443" }],
  } as Game;

  it("does not scan unrelated saves without a registered disc", async () => {
    const noDiscGame = { discs: [] } as unknown as Game;
    const context = {
      game: noDiscGame,
      environmentId: "environment",
      variantId: "variant",
      rpcs3SavedataTitleIds: ["NPUB31848"],
    };
    const savedata = await scanRpcs3SaveRoot(context, "/unused");
    const states = await scanRpcs3Savestates(context, "/unused");

    for (const result of [savedata, states]) {
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "unresolved");
      assert.deepEqual(result.coverage[0].warningCodes, [
        "rpcs3-title-id-unresolved",
      ]);
    }
  });

  it("captures every profile under its own ID and marks unsafe slots partial", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      for (const profileId of ["00000001", "00000002"]) {
        const slot = path.join(
          homeRoot,
          profileId,
          "savedata",
          "BLUS30443-SLOT01"
        );
        await fs.mkdir(slot, { recursive: true });
        await fs.writeFile(path.join(slot, "DATA.BIN"), profileId);
      }
      await fs.writeFile(
        path.join(homeRoot, "00000002", "savedata", "BLUS30443-BROKEN"),
        "not a directory"
      );
      await fs.writeFile(path.join(homeRoot, "localusername"), "not a user");
      await fs.mkdir(path.join(homeRoot, "not-a-profile", "savedata"), {
        recursive: true,
      });
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot
      );

      assert.deepEqual(
        result.files
          .map((file) => [
            file.rawPath,
            file.relativePath,
            file.localBindings.concreteUserSegment,
          ])
          .sort((left, right) => left[0].localeCompare(right[0])),
        [
          [
            "<emulator>/rpcs3/BLUS30443/00000001",
            "BLUS30443-SLOT01/DATA.BIN",
            "00000001",
          ],
          [
            "<emulator>/rpcs3/BLUS30443/00000002",
            "BLUS30443-SLOT01/DATA.BIN",
            "00000002",
          ],
        ]
      );
      assert.deepEqual(
        result.coverage
          .map((item) => [item.rawPath ?? "", item.outcome])
          .sort((left, right) => left[0].localeCompare(right[0])),
        [
          ["<emulator>/rpcs3/BLUS30443/00000001", "scanned"],
          ["<emulator>/rpcs3/BLUS30443/00000002", "partial"],
        ]
      );
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("does not treat a home folder without profiles as an empty save", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "unresolved");
      assert.deepEqual(result.coverage[0].warningCodes, [
        "rpcs3-profiles-missing",
      ]);
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("captures only states for the game's Title ID and all RPCS3 formats", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      for (const name of [
        "BLUS30443_1_0.SAVESTAT",
        "BLUS30443_1_1.SAVESTAT.zst",
        "BLUS30443_1_2.SAVESTAT.gz",
        "BLES99999_1_3.SAVESTAT.zst",
      ]) {
        await fs.writeFile(path.join(states, name), Buffer.alloc(1025));
      }
      const result = await scanRpcs3Savestates(
        { game, environmentId: "environment", variantId: "variant" },
        configRoot
      );
      assert.deepEqual(
        result.files.map((file) => [file.rawPath, file.relativePath]).sort(),
        [
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_0.SAVESTAT"],
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_1.SAVESTAT.zst"],
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_2.SAVESTAT.gz"],
        ]
      );
      assert.equal(result.coverage[0].outcome, "scanned");
      assert.equal(
        result.files[0].localBindings.concreteUserSegment,
        "__default__"
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("records absent savestate roots as confirmed missing", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const context = {
        game,
        environmentId: "environment",
        variantId: "variant",
      };
      const absentRoot = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(absentRoot.files, []);
      assert.equal(absentRoot.coverage[0].outcome, "confirmed-missing");
      assert.equal(absentRoot.coverage[0].selectedRoot, false);
      assert.equal(absentRoot.coverage[0].enumeratedCompletely, true);
      assert.deepEqual(absentRoot.coverage[0].warningCodes, []);

      await fs.mkdir(path.join(configRoot, "savestates"));
      const absentTitle = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(absentTitle.files, []);
      assert.equal(absentTitle.coverage[0].outcome, "confirmed-missing");
      assert.equal(absentTitle.coverage[0].selectedRoot, false);
      assert.equal(absentTitle.coverage[0].enumeratedCompletely, true);
      assert.deepEqual(absentTitle.coverage[0].warningCodes, []);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("marks unknown matching states partial", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const context = {
        game,
        environmentId: "environment",
        variantId: "variant",
      };
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      await fs.writeFile(path.join(states, "BLUS30443_old.SAVESTAT"), "old");
      const partial = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(partial.files, []);
      assert.equal(partial.coverage[0].outcome, "partial");
      await fs.writeFile(
        path.join(states, "BLUS30443_1_1.SAVESTAT.zst"),
        "short"
      );
      const incomplete = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(incomplete.files, []);
      assert.equal(incomplete.coverage[0].outcome, "partial");
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("keeps invalid and symlinked state roots partial", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const context = {
      game,
      environmentId: "environment",
      variantId: "variant",
    };
    try {
      const statesRoot = path.join(configRoot, "savestates");
      await fs.writeFile(statesRoot, "not a directory");
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );

      await fs.unlink(statesRoot);
      await fs.mkdir(path.join(configRoot, "outside"));
      await fs.symlink(path.join(configRoot, "outside"), statesRoot);
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );

      await fs.unlink(statesRoot);
      await fs.mkdir(statesRoot);
      await fs.symlink(
        path.join(configRoot, "outside"),
        path.join(statesRoot, "BLUS30443")
      );
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("scans Minecraft savedata while its savestate folder is absent", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const minecraft = { discs: [{ sku: "NPUB31419" }] } as Game;
    const context = {
      game: minecraft,
      environmentId: "environment",
      variantId: "variant",
    };
    try {
      const homeRoot = path.join(configRoot, "dev_hdd0", "home");
      const saveRoot = path.join(homeRoot, "00000001", "savedata");
      for (const [slot, count] of [
        ["NPUB31419--260930163517", 5],
        ["NPUB31419-OPTIONS", 4],
      ] as const) {
        const slotRoot = path.join(saveRoot, slot);
        await fs.mkdir(slotRoot, { recursive: true });
        for (let index = 0; index < count; index++) {
          await fs.writeFile(path.join(slotRoot, `FILE${index}`), "save");
        }
      }
      await fs.mkdir(path.join(configRoot, "savestates"));

      const [savedata, savestates] = await Promise.all([
        scanRpcs3SaveRoot(context, homeRoot),
        scanRpcs3Savestates(context, configRoot),
      ]);
      assert.equal(savedata.files.length, 9);
      assert.equal(savedata.coverage[0].outcome, "scanned");
      assert.deepEqual(savestates.files, []);
      assert.equal(savestates.coverage[0].outcome, "confirmed-missing");
      assert.deepEqual(savestates.coverage[0].warningCodes, []);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("does not treat an unknown state compression format as deletion", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      await fs.writeFile(
        path.join(states, "BLUS30443_1_1.SAVESTAT.xz"),
        Buffer.alloc(1025)
      );
      const result = await scanRpcs3Savestates(
        {
          game,
          environmentId: "environment",
          variantId: "variant",
        },
        configRoot
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "partial");
      assert.equal(result.coverage[0].enumeratedCompletely, false);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("keeps an absent savedata root partial for a profile", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      await fs.mkdir(path.join(homeRoot, "00000001"));
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "partial");
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  describe("game data profiles", () => {
    const lbpGame = { discs: [{ sku: "BCUS98245" }] } as Game;
    const lbpContext = {
      game: lbpGame,
      environmentId: "environment",
      variantId: "variant",
      rpcs3SavedataTitleIds: ["BCUS98245"],
    };
    const profileSfo = {
      CATEGORY: "GD",
      TITLE_ID: "BCUS98245",
      TITLE: "User LittleBigPlanet 2 Profile",
    };
    const installSfo = { CATEGORY: "GD", TITLE_ID: "BCUS98245" };

    it("captures the <TITLEID>_USER profile folder and ignores installs", async () => {
      const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
      try {
        const gameRoot = path.join(hdd0, "game");
        await writeGamedataFolder(gameRoot, "BCUS98245_USER1", profileSfo, {
          "ICON0.PNG": "icon",
          "USRDIR/bigfart2": "profile",
          "USRDIR/littlefart11": "slots",
        });
        await writeGamedataFolder(gameRoot, "BCUS98245", installSfo, {
          "USRDIR/data.farc": "update",
        });
        await writeGamedataFolder(gameRoot, "BCUS98245_INSTALL", installSfo, {
          "USRDIR/install.bin": "install",
        });
        await writeGamedataFolder(gameRoot, "BCUS98245DATA", installSfo, {
          "USRDIR/dlc.bin": "dlc",
        });
        await writeGamedataFolder(
          gameRoot,
          "BCUS98125_USER1",
          { CATEGORY: "GD", TITLE_ID: "BCUS98125" },
          { "USRDIR/other": "other game" }
        );

        const result = await scanRpcs3Gamedata(lbpContext, hdd0);

        const rawPath = "<emulator>/rpcs3-gamedata/BCUS98245";
        assert.deepEqual(
          result.files
            .map((file) => [file.rawPath, file.relativePath])
            .sort(([, left], [, right]) => left.localeCompare(right)),
          [
            [rawPath, "BCUS98245_USER1/ICON0.PNG"],
            [rawPath, "BCUS98245_USER1/PARAM.SFO"],
            [rawPath, "BCUS98245_USER1/USRDIR/bigfart2"],
            [rawPath, "BCUS98245_USER1/USRDIR/littlefart11"],
          ]
        );
        assert.equal(result.files[0].localBindings.concretePath, gameRoot);
        assert.equal(
          result.files[0].localBindings.concreteUserSegment,
          "__default__"
        );
        assert.equal(result.coverage.length, 1);
        assert.equal(result.coverage[0].rawPath, rawPath);
        assert.equal(result.coverage[0].outcome, "scanned");
        assert.equal(result.coverage[0].enumeratedCompletely, true);
      } finally {
        await fs.rm(hdd0, { recursive: true, force: true });
      }
    });

    for (const [name, sfo] of [
      ["wrong title ID", { CATEGORY: "GD", TITLE_ID: "BCES00850" }],
      ["wrong category", { CATEGORY: "SD", TITLE_ID: "BCUS98245" }],
    ] as const) {
      it(`ignores a profile folder with a ${name} and marks coverage partial`, async () => {
        const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
        try {
          await writeGamedataFolder(
            path.join(hdd0, "game"),
            "BCUS98245_USER1",
            sfo,
            { "USRDIR/bigfart2": "profile" }
          );

          const result = await scanRpcs3Gamedata(lbpContext, hdd0);

          assert.deepEqual(result.files, []);
          assert.equal(result.coverage[0].outcome, "partial");
          assert.equal(result.coverage[0].enumeratedCompletely, false);
        } finally {
          await fs.rm(hdd0, { recursive: true, force: true });
        }
      });
    }

    it("ignores a profile folder without PARAM.SFO and marks coverage partial", async () => {
      const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
      try {
        const usrdir = path.join(hdd0, "game", "BCUS98245_USER1", "USRDIR");
        await fs.mkdir(usrdir, { recursive: true });
        await fs.writeFile(path.join(usrdir, "bigfart2"), "profile");

        const result = await scanRpcs3Gamedata(lbpContext, hdd0);

        assert.deepEqual(result.files, []);
        assert.equal(result.coverage[0].outcome, "partial");
      } finally {
        await fs.rm(hdd0, { recursive: true, force: true });
      }
    });

    it("skips symlinks and marks coverage partial", async () => {
      const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
      try {
        const gameRoot = path.join(hdd0, "game");
        const folderRoot = await writeGamedataFolder(
          gameRoot,
          "BCUS98245_USER1",
          profileSfo,
          { "USRDIR/bigfart2": "profile" }
        );
        const outside = path.join(hdd0, "outside");
        await fs.mkdir(outside);
        await fs.writeFile(path.join(outside, "secret"), "outside");
        await fs.symlink(
          outside,
          path.join(folderRoot, "USRDIR", "linked"),
          "junction"
        );
        await fs.symlink(
          folderRoot,
          path.join(gameRoot, "BCUS98245_USER2"),
          "junction"
        );

        const result = await scanRpcs3Gamedata(lbpContext, hdd0);

        assert.deepEqual(result.files.map((file) => file.relativePath).sort(), [
          "BCUS98245_USER1/PARAM.SFO",
          "BCUS98245_USER1/USRDIR/bigfart2",
        ]);
        assert.equal(result.coverage[0].outcome, "partial");
        assert.deepEqual(result.coverage[0].warningCodes, [
          "emulator-location-partial",
        ]);
      } finally {
        await fs
          .unlink(path.join(hdd0, "game", "BCUS98245_USER2"))
          .catch(() => {});
        await fs
          .unlink(
            path.join(hdd0, "game", "BCUS98245_USER1", "USRDIR", "linked")
          )
          .catch(() => {});
        await fs.rm(hdd0, { recursive: true, force: true });
      }
    });

    it("confirms missing game data without proving deletion", async () => {
      const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
      try {
        const missingRoot = await scanRpcs3Gamedata(lbpContext, hdd0);
        assert.deepEqual(missingRoot.files, []);
        assert.equal(missingRoot.coverage[0].outcome, "confirmed-missing");
        assert.equal(missingRoot.coverage[0].selectedRoot, false);

        await writeGamedataFolder(
          path.join(hdd0, "game"),
          "BCUS98245",
          installSfo,
          { "USRDIR/data.farc": "update" }
        );
        const noProfile = await scanRpcs3Gamedata(lbpContext, hdd0);
        assert.deepEqual(noProfile.files, []);
        assert.equal(noProfile.coverage[0].outcome, "confirmed-missing");
      } finally {
        await fs.rm(hdd0, { recursive: true, force: true });
      }
    });

    it("does not scan game data without a registered disc", async () => {
      const result = await scanRpcs3Gamedata(
        { ...lbpContext, game: { discs: [] } as unknown as Game },
        "/unused"
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "unresolved");
    });
  });
});
