import assert from "node:assert/strict";
import { describe, it } from "node:test";

import meta from "./recompilation-meta.json" with { type: "json" };
import {
  emptyTrophyBitmask,
  getTrophySourcePath,
  keepCatalogueTrophies,
  parseTrophyBitmask,
  parseTrophyEarnedJson,
  parseTrophyIdTimeLines,
  parseTrophyJsonLines,
  parseTrophyLogLines,
  removeTrophiesFromBitmask,
  removeTrophiesFromEarnedJson,
  removeTrophiesFromIdLines,
  removeTrophiesFromIdTimeLines,
  removeTrophiesFromJsonLines,
  stripTrophyLogLines,
  withHydraPlatinum,
  type RecompilationTrophySource,
} from "./recompilation-trophies.js";

const NOW = 1_762_790_400_000;
const names = (unlocks: { name: string }[]) =>
  unlocks.map((unlock) => unlock.name);
const catalogue = (count: number) =>
  Array.from({ length: count }, (_, id) => String(id));
const sourceOf = (slug: string) =>
  (meta as Record<string, { trophies?: RecompilationTrophySource }>)[slug]
    .trophies!;

describe("parseTrophyBitmask", () => {
  it("reads one bit per trophy from the first 16 bytes, timed now", () => {
    const data = Buffer.alloc(16);
    data.writeUInt32LE((1 << 1) | (1 << 7), 0);
    data.writeUInt32LE(1 << 2, 4);

    assert.deepEqual(parseTrophyBitmask(data, NOW), [
      { name: "1", unlockTime: NOW },
      { name: "7", unlockTime: NOW },
      { name: "34", unlockTime: NOW },
    ]);
  });

  it("drops junk past 16 bytes and bits above the trophy count", () => {
    const data = Buffer.alloc(4096, 0xff);
    data.fill(0, 0, 16);
    data[0] = 0b10;
    data[15] = 0x80;

    const unlocks = parseTrophyBitmask(data, NOW);
    assert.deepEqual(names(unlocks), ["1", "127"]);
    assert.deepEqual(names(keepCatalogueTrophies(unlocks, catalogue(35))), [
      "1",
    ]);
  });
});

describe("parseTrophyIdTimeLines", () => {
  it("reads id and unix time per line, keeping the first time", () => {
    assert.deepEqual(
      parseTrophyIdTimeLines(
        "12 1762790400\r\n3 1762790500\n\nbad line\n12 1762790999\n"
      ),
      [
        { name: "12", unlockTime: 1_762_790_400_000 },
        { name: "3", unlockTime: 1_762_790_500_000 },
      ]
    );
  });
});

describe("parseTrophyJsonLines", () => {
  it("reads repeated events once, with the earliest date", () => {
    const line = (id: number, date: string) =>
      JSON.stringify({
        v: 1,
        title_id: "CUSA03173",
        trophy_id: id,
        unlocked_at: date,
      });

    assert.deepEqual(
      parseTrophyJsonLines(
        [
          line(12, "2026-10-10T06:30:00Z"),
          line(12, "2026-10-09T06:30:00Z"),
          "{broken",
          line(5, "2026-10-11T00:00:00Z"),
          JSON.stringify({ trophy_id: 7 }),
        ].join("\n")
      ),
      [
        { name: "12", unlockTime: Date.parse("2026-10-09T06:30:00Z") },
        { name: "5", unlockTime: Date.parse("2026-10-11T00:00:00Z") },
      ]
    );
  });
});

describe("parseTrophyLogLines", () => {
  it("reads the trophy ids the port logs", () => {
    assert.deepEqual(
      parseTrophyLogLines(
        [
          "Runtime: trophies: 35 in trophy00.trp, 0 already unlocked",
          "Runtime: trophy 5 unlocked\r",
          "Runtime: trophy 0 (platinum) unlocked",
          "Runtime: trophy 5 unlocked",
        ].join("\n")
      ),
      [5, 0, 5]
    );
  });
});

describe("withHydraPlatinum", () => {
  const unlock = (name: string, unlockTime = NOW) => ({ name, unlockTime });

  it("grants the platinum once every other trophy is unlocked", () => {
    assert.deepEqual(
      withHydraPlatinum([unlock("2", NOW + 5)], catalogue(3), [
        unlock("1", NOW),
      ]),
      [unlock("2", NOW + 5), unlock("0", NOW + 5)]
    );
  });

  it("waits for the missing trophies and skips catalogues with no platinum", () => {
    assert.deepEqual(withHydraPlatinum([unlock("2")], catalogue(3), []), [
      unlock("2"),
    ]);
    assert.deepEqual(
      withHydraPlatinum([unlock("2")], ["1", "2"], [unlock("1")]),
      [unlock("2")]
    );
  });
});

describe("recompilation trophy sources", () => {
  it("resolves the Linux paths under the XDG data folder", () => {
    assert.equal(
      getTrophySourcePath(sourceOf("spartanport"), "linux"),
      "<xdgData>/spartanport/user/trophies.dat"
    );
    assert.equal(
      getTrophySourcePath(sourceOf("bbport"), "linux"),
      "<xdgData>/bbport/user/trophies.jsonl"
    );
    assert.equal(getTrophySourcePath(sourceOf("bloodborne-pc"), "linux"), null);
  });

  it("reads every Windows port from its own folder", () => {
    for (const slug of [
      "spartanport",
      "bloodborne-pc",
      "bbport",
      "shadowofthecolossus-pc",
    ]) {
      assert.match(
        getTrophySourcePath(sourceOf(slug), "win32") ?? "",
        /^<base>\/user\//
      );
    }
  });
});

describe("trophy reset", () => {
  it("writes a bitmask with no trophy unlocked", () => {
    assert.deepEqual(parseTrophyBitmask(emptyTrophyBitmask(), NOW), []);
    assert.equal(emptyTrophyBitmask().length, 16);
  });

  it("takes only the trophy lines out of a log", () => {
    const log = [
      "Runtime: boot\r",
      "Runtime: trophy 5 unlocked\r",
      "Runtime: trophy 0 (platinum) unlocked",
      "Runtime: frame 10",
      "",
    ].join("\n");
    const stripped = stripTrophyLogLines(log);
    assert.equal(stripped, "Runtime: boot\r\nRuntime: frame 10\n");
    assert.deepEqual(parseTrophyLogLines(stripped), []);
  });

  it("clears the file bbport uses to know what was unlocked", () => {
    const source = (
      meta as Record<string, { trophies?: RecompilationTrophySource }>
    ).bbport.trophies!;
    assert.deepEqual(source.resetFiles?.win32, [
      "<base>/user/trophy/NPWR05818_00/unlocked.txt",
    ]);
  });
});

describe("removing trophies after a reset with the port open", () => {
  it("clears only those bits", () => {
    const data = Buffer.from([
      0b0010_0001,
      0b0000_0001,
      0,
      0,
      ...new Array(12).fill(0),
    ]);
    const kept = removeTrophiesFromBitmask(data, ["0", "8"]);
    assert.deepEqual(names(parseTrophyBitmask(kept, NOW)), ["5"]);
    assert.equal(kept.length, data.length);
  });

  it("drops only those id/time lines", () => {
    const kept = removeTrophiesFromIdTimeLines("5 100\n12 200\n7 300\n", [
      "12",
    ]);
    assert.deepEqual(names(parseTrophyIdTimeLines(kept)), ["5", "7"]);
  });

  it("drops only those JSON events, repeats included", () => {
    const line = (id: number) =>
      JSON.stringify({ trophy_id: id, unlocked_at: "2026-11-10T06:30:00Z" });
    const kept = removeTrophiesFromJsonLines(
      [line(3), line(4), line(3), ""].join("\n"),
      ["3"]
    );
    assert.deepEqual(names(parseTrophyJsonLines(kept)), ["4"]);
  });

  it("drops only those ids and keeps comments", () => {
    const kept = removeTrophiesFromIdLines(
      "# the trophies unlocked here\n7\n9\n",
      ["7"]
    );
    assert.equal(kept, "# the trophies unlocked here\n9\n");
  });
});

describe("iss_pc earned.json trophies", () => {
  const ledger = JSON.stringify({
    schema: 1,
    title_id: "CUSA00223",
    package_fingerprint: "abc123",
    save_identity: "",
    earned: [
      { id: 12, time: 1794490457 },
      { id: 3, time: 1794490000 },
    ],
    recovered: [],
  });

  it("reads the earned trophies and their unlock times", () => {
    assert.deepEqual(parseTrophyEarnedJson(ledger), [
      { name: "12", unlockTime: 1794490457000 },
      { name: "3", unlockTime: 1794490000000 },
    ]);
    assert.deepEqual(parseTrophyEarnedJson("not json"), []);
  });

  it("removes reset trophies and keeps the rest of the ledger", () => {
    const changed = JSON.parse(removeTrophiesFromEarnedJson(ledger, ["12"]));
    assert.deepEqual(changed.earned, [{ id: 3, time: 1794490000 }]);
    assert.equal(changed.package_fingerprint, "abc123");
    assert.equal(changed.title_id, "CUSA00223");
    assert.equal(removeTrophiesFromEarnedJson(ledger, ["40"]), ledger);
  });
});

describe("new PS4 port trophy sources", () => {
  it("keeps CTR trophies per game ID and inFAMOUS in its ledger", () => {
    const sources = meta as Record<
      string,
      { trophies?: RecompilationTrophySource }
    >;
    assert.equal(
      getTrophySourcePath(sources["octr-nitrofueled-pc"].trophies!, "linux"),
      "<xdgData>/sacredfire/user/trophies/{titleId}/unlocked.txt"
    );
    assert.equal(sources["iss-pc"].trophies!.kind, "earned-json");
    assert.equal(sources["pt-pc"].trophies, undefined);
  });
});
