import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTrophyDefinitions,
  parseTrophyStates,
  trophyTimestampToMillis,
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
  it("joins names, secret state, grade, score and dates by stable trophy IDs", () => {
    const rows = parseTrophyDefinitions(
      definitions(),
      setId,
      "/fixture",
      parseTrophyStates(stateFile([1]))
    );
    assert.deepEqual(
      rows.map((row) => row.points),
      [7500, 375, 750, 2250]
    );
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
