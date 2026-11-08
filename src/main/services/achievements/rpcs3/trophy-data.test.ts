import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseTrophyDefinitions,
  parseTrophyStates,
  trophyTimestampToMillis,
  TrophyDefinitionCache,
  readTrophySet,
} from "./trophy-data.js";

const setId = "NPWR12345_00";
export const definitions = (id = setId) =>
  Buffer.from(`<trophyconf><npcommid>${id}</npcommid><title-name>Fixture collection</title-name>
<trophy id="000" hidden="no" ttype="P"><name>Complete</name><detail>Earn the other trophies</detail></trophy>
<trophy id="001" hidden="yes" ttype="B"><name>First &amp; foremost</name><detail>A secret task</detail></trophy>
<trophy id="002" hidden="no" ttype="S"><name>Second</name></trophy>
<trophy id="003" hidden="no" ttype="G"><name>Third</name></trophy></trophyconf>`);

export const stateFile = (earned: number[] = [], extraTables = false) => {
  const tables = extraTables ? 3 : 1;
  const start = 48 + tables * 32 + (extraTables ? 64 : 0);
  const data = Buffer.alloc(start + 4 * 112);
  data.writeUInt32BE(0x818f54ad, 0);
  data.writeUInt32BE(tables, 8);
  const header = 48 + (extraTables ? 64 : 0);
  data.writeUInt32BE(6, header);
  data.writeUInt32BE(96, header + 4);
  data.writeUInt32BE(4, header + 12);
  data.writeBigUInt64BE(BigInt(start), header + 16);
  for (let i = 0; i < 4; i++) {
    const pos = start + i * 112;
    data.writeUInt32BE(6, pos);
    data.writeUInt32BE(96, pos + 4);
    data.writeUInt32BE(i, pos + 16);
    if (earned.includes(i)) {
      data.writeUInt32BE(1, pos + 20);
      data.writeBigUInt64BE(62135596800000000n + 1700000000123000n, pos + 40);
    }
  }
  return data;
};

describe("RPCS3 trophy files", () => {
  it("reuses unchanged definitions but rereads unlocks, invalidates replacements and rejects corrupt updates", async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-trophy-cache-")
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "TROPCONF.SFM");
    const state = path.join(root, "TROPUSR.DAT");
    let parses = 0;
    const cache = new TrophyDefinitionCache((...args) => {
      parses++;
      return parseTrophyDefinitions(...args);
    });
    await fs.writeFile(file, definitions());
    await fs.writeFile(state, stateFile());
    const locked = await readTrophySet(root, setId, true, cache);
    await fs.writeFile(state, stateFile([1]));
    const earned = await readTrophySet(root, setId, true, cache);
    assert.equal(parses, 1);
    assert.equal(locked[1].unlocked, false);
    assert.equal(earned[1].unlocked, true);
    assert.equal(earned[1].unlockTime, 1700000000123);
    earned[0].displayName = "mutated by caller";
    if (earned[0].set) earned[0].set.name = "mutated set";
    const unchanged = await readTrophySet(root, setId, true, cache);
    assert.equal(unchanged[0].displayName, "Complete");
    assert.equal(unchanged[0].set?.name, "Fixture collection");
    assert.equal(parses, 1);
    await fs.writeFile(
      file,
      definitions().toString().replace("Complete", "Finished")
    );
    const modified = new Date(Date.now() + 10000);
    await fs.utimes(file, modified, modified);
    assert.equal(
      (await readTrophySet(root, setId, true, cache))[0].displayName,
      "Finished"
    );
    assert.equal(parses, 2);
    const previous = await fs.stat(file);
    const replacement = path.join(root, "replacement");
    await fs.writeFile(
      replacement,
      definitions().toString().replace("Complete", "Replaced")
    );
    await fs.utimes(replacement, previous.atime, previous.mtime);
    await fs.rename(replacement, file);
    assert.equal(
      (await readTrophySet(root, setId, true, cache))[0].displayName,
      "Replaced"
    );
    assert.equal(parses, 3);
    await fs.writeFile(state, Buffer.alloc(12));
    await assert.rejects(
      readTrophySet(root, setId, true, cache),
      /Invalid TROPUSR/
    );
    assert.equal(parses, 3);
    await fs.writeFile(state, stateFile([2]));
    assert.equal(
      (await readTrophySet(root, setId, true, cache))[2].unlocked,
      true
    );
    await assert.rejects(
      readTrophySet(root, "NPWR99999_00", true, cache),
      /identity mismatch/
    );
    await fs.writeFile(file, "<trophyconf>");
    await assert.rejects(readTrophySet(root, setId, true, cache));
    await fs.writeFile(file, definitions());
    assert.equal((await readTrophySet(root, setId, true, cache)).length, 4);
    const beforeClear = parses;
    cache.clear();
    await readTrophySet(root, setId, true, cache);
    assert.equal(parses, beforeClear + 1);
    await fs.unlink(file);
    await assert.rejects(readTrophySet(root, setId, true, cache), {
      code: "ENOENT",
    });
  });
  it("joins names, secret state, grades and dates without assigning points", () => {
    const rows = parseTrophyDefinitions(
      definitions(),
      setId,
      "/fixture",
      parseTrophyStates(stateFile([1]))
    );
    assert.deepEqual(
      rows.map((row) => row.trophyGrade),
      ["platinum", "bronze", "silver", "gold"]
    );
    assert.ok(rows.every((row) => !Object.hasOwn(row, "points")));
    assert.equal(rows[0].unlocked, false);
    assert.equal(rows[1].unlocked, true);
    assert.equal(rows[1].unlockTime, 1700000000123);
    assert.equal(rows[1].displayName, "First & foremost");
    assert.equal(rows[1].hidden, true);
    assert.equal(rows[1].name, `${setId}:1`);
    assert.equal(rows[1].globalUnlockPercentage, null);
  });
  it("uses table offsets with additional console tables and missing state records", () => {
    const states = parseTrophyStates(stateFile([2], true));
    states.delete(3);
    const rows = parseTrophyDefinitions(
      definitions(),
      setId,
      "/fixture",
      states
    );
    assert.equal(rows[2].unlocked, true);
    assert.equal(rows[3].unlocked, false);
    assert.equal(rows[3].unlockTime, null);
  });
  it("keeps earned trophies with unknown dates earned without inventing dates", () => {
    const data = stateFile([1]);
    data.writeBigUInt64BE(0n, 80 + 112 + 40);
    const row = parseTrophyDefinitions(
      definitions(),
      setId,
      "/fixture",
      parseTrophyStates(data)
    )[1];
    assert.equal(row.unlocked, true);
    assert.equal(row.unlockTime, null);
    assert.equal(trophyTimestampToMillis(0n), null);
    assert.equal(trophyTimestampToMillis(0xffffffffffffffffn), null);
  });
  it("rejects partial data, out-of-range offsets, duplicate IDs and invalid states", () => {
    assert.throws(() => parseTrophyStates(stateFile().subarray(0, 100)));
    const offset = stateFile();
    offset.writeBigUInt64BE(0xffffffffffffffffn, 64);
    assert.throws(() => parseTrophyStates(offset));
    const duplicate = stateFile();
    duplicate.writeUInt32BE(0, 80 + 112 + 16);
    assert.throws(() => parseTrophyStates(duplicate));
    const state = stateFile();
    state.writeUInt32BE(2, 80 + 20);
    assert.throws(() => parseTrophyStates(state));
    const missingTable = stateFile();
    missingTable.writeUInt32BE(4, 48);
    assert.throws(
      () => parseTrophyStates(missingTable),
      /Missing TROPUSR state table/
    );
    const duplicateTable = stateFile([], true);
    duplicateTable.writeUInt32BE(6, 48);
    assert.throws(
      () => parseTrophyStates(duplicateTable),
      /Duplicate TROPUSR state table/
    );
    const invalidStride = stateFile();
    invalidStride.writeUInt32BE(95, 52);
    assert.throws(() => parseTrophyStates(invalidStride), /state table bounds/);
  });
  it("validates XML identities, avoids entity expansion and separates collection IDs", () => {
    assert.throws(() =>
      parseTrophyDefinitions(
        definitions(),
        "NPWR99999_00",
        "/fixture",
        new Map()
      )
    );
    assert.throws(() =>
      parseTrophyDefinitions(
        Buffer.from("<!DOCTYPE trophyconf><trophyconf/>"),
        setId,
        "/fixture",
        new Map()
      )
    );
    assert.throws(() =>
      parseTrophyDefinitions(
        Buffer.from("<trophyconf>"),
        setId,
        "/fixture",
        new Map()
      )
    );
    const a = parseTrophyDefinitions(
      definitions(),
      setId,
      "/fixture",
      new Map()
    );
    const b = parseTrophyDefinitions(
      definitions("NPWR12346_00"),
      "NPWR12346_00",
      "/fixture",
      new Map()
    );
    assert.notEqual(a[0].name, b[0].name);
    assert.notEqual(a[0].set?.id, b[0].set?.id);
  });
  it("reads a decrypted retail SFM wrapper", () => {
    const header = Buffer.alloc(64);
    header.writeUInt32BE(0x450195ba);
    assert.equal(
      parseTrophyDefinitions(
        Buffer.concat([header, definitions()]),
        setId,
        "/fixture",
        new Map()
      ).length,
      4
    );
  });
});
