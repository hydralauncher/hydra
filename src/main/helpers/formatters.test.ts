import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dodiFormatter,
  empressFormatter,
  fitGirlFormatter,
  kaosKrewFormatter,
} from "./formatters";

describe("testing formatters", () => {
  describe("testing fitgirl formatter", () => {
    const fitGirlGames = [
      "REVEIL (v1.0.3f4 + 0.5 DLC, MULTi14) [FitGirl Repack]",
      "Dune: Spice Wars - The Ixian Edition (v2.0.0.31558 + DLC, MULTi9) [FitGirl Repack]",
      "HUMANKIND: Premium Edition (v1.0.22.3819 + 17 DLCs/Bonus Content, MULTi12) [FitGirl Repack, Selective Download - from 7.3 GB]",
      "Call to Arms: Gates of Hell - Ostfront: WW2 Bundle (v1.034 Hotfix 3 + 3 DLCs, MULTi9) [FitGirl Repack, Selective Download - from 21.8 GB]",
      "SUPER BOMBERMAN R 2 (v1.2.0, MULTi12) [FitGirl Repack]",
      "God of Rock (v3110, MULTi11) [FitGirl Repack]",
    ];

    test("should format games correctly", () => {
      assert.equal(fitGirlGames.map(fitGirlFormatter), [
        "REVEIL",
        "Dune: Spice Wars - The Ixian Edition",
        "HUMANKIND: Premium Edition",
        "Call to Arms: Gates of Hell - Ostfront: WW2 Bundle",
        "SUPER BOMBERMAN R 2",
        "God of Rock",
      ]);
    });
  });

  describe("testing kaoskrew formatter", () => {
    const kaosKrewGames = [
      "Song.Of.Horror.Complete.Edition.v1.25.MULTi4.REPACK-KaOs",
      "Remoteness.REPACK-KaOs",
      "Persona.5.Royal.v1.0.0.MULTi5.NSW.For.PC.REPACK-KaOs",
      "The.Wreck.MULTi5.REPACK-KaOs",
      "Nemezis.Mysterious.Journey.III.v1.04.Deluxe.Edition.REPACK-KaOs",
      "The.World.Of.Others.v1.05.REPACK-KaOs",
    ];

    test("should format games correctly", () => {
      assert.equal(kaosKrewGames.map(kaosKrewFormatter), [
        "Song Of Horror Complete Edition",
        "Remoteness",
        "Persona 5 Royal NSW For PC",
        "The Wreck",
        "Nemezis Mysterious Journey III Deluxe Edition",
        "The World Of Others",
      ]);
    });
  });

  describe("testing empress formatter", () => {
    const empressGames = [
      "Resident.Evil.4-EMPRESS",
      "Marvels.Guardians.of.the.Galaxy.Crackfix-EMPRESS",
      "Life.is.Strange.2.Complete.Edition-EMPRESS",
      "Forza.Horizon.4.PROPER-EMPRESS",
      "Just.Cause.4.Complete.Edition.READNFO-EMPRESS",
      "Immortals.Fenyx.Rising.Crackfix.V2-EMPRESS",
    ];

    test("should format games correctly", () => {
      assert.equal(empressGames.map(empressFormatter), [
        "Resident Evil 4",
        "Marvels Guardians of the Galaxy",
        "Life is Strange 2 Complete Edition",
        "Forza Horizon 4 PROPER",
        "Just Cause 4 Complete Edition",
        "Immortals Fenyx Rising",
      ]);
    });
  });

  describe("testing kodi formatter", () => {
    const dodiGames = [
      "Tomb Raider I-III Remastered Starring Lara Croft (MULTi20) (From 2.5 GB) [DODI Repack]",
      "Trail Out: Complete Edition (v2.9st + All DLCs + MULTi11) [DODI Repack]",
      "Call to Arms - Gates of Hell: Ostfront (v1.034.0 + All DLCs + MULTi9) (From 22.4 GB) [DODI Repack]",
      "Metal Gear Solid 2: Sons of Liberty - HD Master Collection Edition (Digital book + MULTi6) [DODI Repack]",
      "DREDGE: Digital Deluxe Edition (v1.2.0.1922 + All DLCs + Bonus Content + MULTi11) (From 413 MB) [DODI Repack]",
      "Outliver: Tribulation [DODI Repack]",
    ];

    test("should format games correctly", () => {
      assert.equal(dodiGames.map(dodiFormatter), [
        "Tomb Raider I-III Remastered Starring Lara Croft",
        "Trail Out: Complete Edition",
        "Call to Arms - Gates of Hell: Ostfront",
        "Metal Gear Solid 2: Sons of Liberty - HD Master Collection Edition",
        "DREDGE: Digital Deluxe Edition",
        "Outliver: Tribulation",
      ]);
    });
  });
});
