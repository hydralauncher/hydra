import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { parseSaveSummary } from "./save-insights-contract.ts";

const summary = {
  schemaVersion: 1,
  parsers: ["ghost-of-tsushima@1"],
  profile: [],
  slots: [
    {
      id: "auto",
      kind: "auto",
      savedAtMs: 1700000000000,
      playthrough: "run-test-playthrough",
      stats: [
        { kind: "playtime", value: { type: "seconds", value: 36000 } },
        {
          kind: "money",
          value: { type: "integer", value: 4200 },
          name: { key: "ghost_of_tsushima.stat.supplies", text: "Supplies" },
        },
        {
          kind: "difficulty",
          value: {
            type: "label",
            value: {
              key: "ghost_of_tsushima.difficulty.normal",
              text: "Normal",
            },
          },
        },
      ],
      files: ["auto.sav"],
    },
  ],
};

describe("save insights contract", () => {
  it("parses a summary from the native JSON", () => {
    assert.deepEqual(parseSaveSummary(JSON.stringify(summary)), summary);
  });

  it("drops a malformed stat name but keeps the stat", () => {
    const parsed = parseSaveSummary({
      ...summary,
      slots: [
        {
          ...summary.slots[0],
          stats: [
            {
              kind: "money",
              value: { type: "integer", value: 1 },
              name: { key: 7 },
            },
          ],
        },
      ],
    });
    assert.deepEqual(parsed?.slots[0].stats, [
      { kind: "money", value: { type: "integer", value: 1 } },
    ]);
  });

  it("drops what it does not understand instead of failing", () => {
    const parsed = parseSaveSummary({
      ...summary,
      slots: [
        {
          ...summary.slots[0],
          kind: "future-kind",
          stats: [
            ...summary.slots[0].stats,
            { kind: "unknownKind", value: { type: "integer", value: 1 } },
            { kind: "level", value: { type: "integer", value: "8" } },
          ],
        },
        { kind: "manual", stats: [] },
      ],
    });
    assert.equal(parsed?.slots.length, 1);
    assert.equal(parsed?.slots[0].kind, "unknown");
    assert.equal(parsed?.slots[0].stats.length, 3);
  });

  it("rejects other schema versions and empty summaries", () => {
    assert.equal(parseSaveSummary({ ...summary, schemaVersion: 2 }), null);
    assert.equal(parseSaveSummary({ ...summary, slots: [] }), null);
    assert.equal(parseSaveSummary("{"), null);
    assert.equal(parseSaveSummary(null), null);
  });
});
