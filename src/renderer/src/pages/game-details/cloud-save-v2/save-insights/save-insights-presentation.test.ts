import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SaveStat, SaveSummary, SaveSummarySlot } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./save-insights-presentation.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import * as gamesModule from "./save-insights-games.ts";

const {
  buildSaveCard,
  buildSaveConflict,
  canShowSaveCard,
  formatDuration,
  newestSlot,
} = presentationModule;
const { getSaveInsightsGame } = gamesModule;

const TEMPLATES: Record<string, string> = {
  save_insights_duration_hours: "{{hours}} h {{minutes}} min",
  save_insights_duration_minutes: "{{minutes}} min",
  save_insights_level: "Level {{level}}",
  save_insights_day: "Day {{day}}",
  save_insights_playing_as: "Playing as {{name}}",
  save_insights_new_game_plus: "New Game+ {{cycle}}",
  save_insights_slot_manual: "Manual save",
  save_insights_slot_auto: "Auto save",
  save_insights_none: "None",
  save_insights_replaces_cloud: "Replaces the cloud saves",
  save_insights_replaces_local: "Replaces the saves on this PC",
  save_insights_replaces_play: "Replaces {{duration}} of play",
  save_insights_loses_play: "Loses {{duration}} of play",
  save_insights_removes_character: "Removes {{name}}",
  save_insights_character_loses_levels: "{{name}} loses {{count}} levels",
  save_insights_unit_eddies: "eddies",
  save_insights_unit_street_cred: "street cred",
  save_insights_stat_level: "Level",
  save_insights_stat_playtime: "Playtime",
  save_insights_character_tile: "{{name}}, level {{level}}",
};

const text = {
  t: (key: string, options: Record<string, unknown> = {}) =>
    (TEMPLATES[key] ?? key).replace(/{{(\w+)}}/g, (_, name) =>
      String(options[name])
    ),
  label: (_key: string, value: string) => value,
  number: (value: number) => new Intl.NumberFormat("en").format(value),
  date: (ms: number) => `@${ms}`,
};

const integer = (value: number) => ({ type: "integer" as const, value });
const seconds = (value: number) => ({ type: "seconds" as const, value });
const label = (value: string) => ({
  type: "label" as const,
  value: { key: `game.field.${value.toLowerCase()}`, text: value },
});
const stat = (kind: SaveStat["kind"], value: SaveStat["value"]): SaveStat => ({
  kind,
  value,
});

const slot = (
  id: string,
  savedAtMs: number,
  stats: SaveStat[],
  extra: Partial<SaveSummarySlot> = {}
): SaveSummarySlot => ({
  id,
  kind: "manual",
  savedAtMs,
  stats,
  files: [],
  ...extra,
});

const summary = (...slots: SaveSummarySlot[]): SaveSummary => ({
  schemaVersion: 1,
  parsers: ["test@1"],
  profile: [],
  slots,
});

const cyberpunk = getSaveInsightsGame("steam", "1091500");
const eldenRing = getSaveInsightsGame("steam", "1245620");

const cyberpunkSlot = (
  id: string,
  savedAtMs: number,
  level: number,
  playtime: number,
  cred: number,
  playthrough = "run-a"
) =>
  slot(
    id,
    savedAtMs,
    [
      stat("level", integer(level)),
      stat("playtime", seconds(playtime)),
      {
        ...stat("money", integer(48250)),
        name: { key: "cyberpunk_2077.stat.eddies", text: "Eddies" },
      },
      {
        ...stat("reputation", integer(cred)),
        name: { key: "cyberpunk_2077.stat.street_cred", text: "Street Cred" },
      },
      stat("characterClass", label("Nomad")),
      stat("difficulty", label("Very Hard")),
    ],
    { playthrough }
  );

describe("save insights presentation", () => {
  it("formats durations without seconds", () => {
    assert.equal(formatDuration(38 * 60 + 59, text), "38 min");
    assert.equal(formatDuration(4 * 3600 + 41 * 60, text), "4 h 41 min");
    assert.equal(formatDuration(9 * 3600 + 5 * 60, text), "9 h 05 min");
  });

  it("builds a card from the newest slot", () => {
    const card = buildSaveCard(
      summary(
        cyberpunkSlot("ManualSave-1", 10, 7, 100, 1),
        cyberpunkSlot("ManualSave-2", 20, 21, 45240, 33)
      ),
      cyberpunk,
      text
    );
    assert.ok(card);
    assert.equal(card.slot.id, "ManualSave-2");
    assert.equal(card.heading, "Level 21");
    assert.equal(card.subtitle, "Nomad · Very Hard");
    assert.deepEqual(
      card.stats.map((item) => [item.value, item.unit]),
      [
        ["12 h 34 min", null],
        ["48,250", "eddies"],
        ["33", "street cred"],
      ]
    );
    assert.equal(card.footer, "Manual save · @20");
    assert.equal(card.slotCount, 2);
    assert.deepEqual(card.tiles, []);
  });

  it("shows character tiles and the picked character", () => {
    const character = (id: string, name: string, level: number) =>
      slot(id, 5, [
        stat("characterName", { type: "text", value: name }),
        stat("level", integer(level)),
        stat("location", label("Stormveil Castle")),
      ]);
    const save = summary(
      character("character-0", "Tarnished", 56),
      character("character-1", "Pot Boy", 9)
    );
    const card = buildSaveCard(save, eldenRing, text, "character-1");
    assert.ok(card);
    assert.equal(card.heading, "Pot Boy");
    assert.deepEqual(
      card.tiles.map((tile) => tile.text),
      ["56", "9"]
    );
    assert.equal(card.stats[0].value, "9");
    assert.equal(eldenRing.scene?.(card.slot).id, "elden-ring-stormveil");
  });

  it("puts the further side first in a same-playthrough conflict", () => {
    const conflict = buildSaveConflict(
      summary(cyberpunkSlot("ManualSave-10", 100, 7, 4 * 3600 + 34 * 60, 10)),
      summary(cyberpunkSlot("ManualSave-11", 200, 8, 4 * 3600 + 41 * 60, 11)),
      cyberpunk,
      text
    );
    assert.ok(conflict);
    assert.equal(conflict.headline, "remote-ahead");
    assert.equal(conflict.samePlaythrough, true);
    assert.equal(conflict.primary, "remote");
    assert.deepEqual(
      conflict.rows.map((row) => [row.name, row.local, row.remote, row.delta]),
      [
        ["Level", "7", "8", "1"],
        ["Playtime", "4 h 34 min", "4 h 41 min", "7 min"],
        ["Street Cred", "10", "11", "1"],
      ]
    );
    assert.equal(conflict.consequences.local.text, "Replaces the cloud saves");
    assert.equal(conflict.consequences.local.warn, false);
  });

  it("warns about hours of play lost", () => {
    const conflict = buildSaveConflict(
      summary(cyberpunkSlot("ManualSave-1", 300, 7, 3600, 10)),
      summary(cyberpunkSlot("ManualSave-2", 100, 9, 4 * 3600, 12)),
      cyberpunk,
      text
    );
    assert.ok(conflict);
    assert.equal(conflict.newerButBehind, "local");
    assert.deepEqual(conflict.consequences.local, {
      text: "Loses 3 h 00 min of play",
      warn: true,
    });
  });

  it("shows two runs when the playthroughs differ", () => {
    const conflict = buildSaveConflict(
      summary(cyberpunkSlot("ManualSave-1", 300, 3, 72 * 60, 1, "run-a")),
      summary(cyberpunkSlot("ManualSave-2", 100, 30, 31 * 3600, 40, "run-b")),
      cyberpunk,
      text
    );
    assert.ok(conflict);
    assert.equal(conflict.headline, "different-runs");
    assert.equal(conflict.primary, "remote");
    assert.equal(conflict.runs?.length, 2);
    assert.deepEqual(conflict.consequences.local, {
      text: "Replaces 31 h 00 min of play",
      warn: true,
    });
    assert.equal(conflict.consequences.remote.warn, true);
  });

  it("compares characters slot by slot", () => {
    const character = (id: string, name: string, level: number) =>
      slot(id, 5, [
        stat("characterName", { type: "text", value: name }),
        stat("level", integer(level)),
      ]);
    const conflict = buildSaveConflict(
      summary(
        character("character-0", "Tarnished", 61),
        character("character-1", "Ranni's Knight", 23)
      ),
      summary(
        character("character-0", "Tarnished", 56),
        character("character-1", "Ranni's Knight", 23),
        character("character-2", "Pot Boy", 9)
      ),
      eldenRing,
      text
    );
    assert.ok(conflict);
    assert.equal(conflict.headline, "mixed");
    assert.equal(conflict.primary, null);
    assert.deepEqual(
      conflict.characters.map((row) => [row.name, row.local, row.remote]),
      [
        ["Tarnished", "Level 61", "Level 56"],
        ["Pot Boy", "None", "Level 9"],
      ]
    );
    assert.equal(conflict.consequences.local.text, "Removes Pot Boy");
    assert.equal(conflict.consequences.remote.text, "Tarnished loses 5 levels");
  });

  it("knows when there is nothing to show", () => {
    assert.equal(canShowSaveCard(null), false);
    assert.equal(
      canShowSaveCard({
        schemaVersion: 1,
        parsers: [],
        profile: [stat("achievements", integer(23))],
        slots: [],
      }),
      true
    );
    assert.equal(newestSlot(summary()), null);
  });
});

describe("save insights scenes", () => {
  const sceneOf = (objectId: string, stats: SaveStat[]) =>
    getSaveInsightsGame("steam", objectId).scene?.(slot("s", 1, stats));

  it("maps save values to scenes", () => {
    assert.equal(
      sceneOf("2215430", [stat("location", label("Iki Island"))])?.id,
      "got-iki"
    );
    assert.equal(sceneOf("2215430", [])?.id, "got-fallback");
    const tsushima = (hours: number) =>
      sceneOf("2215430", [
        stat("location", label("Tsushima")),
        stat("playtime", seconds(hours * 3600)),
      ])?.id;
    assert.equal(tsushima(0.5), "got-komoda");
    assert.equal(tsushima(5), "got-izuhara");
    assert.equal(tsushima(25), "got-toyotama");
    assert.equal(tsushima(60), "got-kamiagata");
    assert.equal(
      sceneOf("504230", [stat("chapter", label("Mirror Temple B-Side"))])
        ?.overlay,
      "celeste-fog-red"
    );
    assert.equal(
      sceneOf("254700", [stat("characterName", label("Ashley"))])?.id,
      "re4-ashley"
    );
    assert.equal(
      sceneOf("254700", [stat("location", label("The Farm (Night)"))])?.id,
      "re4-village-night"
    );
    assert.equal(
      sceneOf("374320", [
        stat("location", label("Road of Sacrifices / Farron Keep")),
      ])?.id,
      "ds3-farron"
    );
    assert.equal(
      sceneOf("1174180", [stat("completion", { type: "percent", value: 97.7 })])
        ?.id,
      "rdr2-ranch"
    );
    assert.deepEqual(getSaveInsightsGame("epic", "1091500"), {});
  });
});
