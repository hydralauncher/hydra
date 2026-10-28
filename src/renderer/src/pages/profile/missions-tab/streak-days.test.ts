import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStreakDays } from "./streak-days.js";

// Monday 2026-10-26, 15:00 UTC.
const NOW = Date.UTC(2026, 9, 26, 15);

const render = (current: number, hasPlayedToday: boolean, now = NOW) =>
  buildStreakDays({ current, record: current, hasPlayedToday }, now).map(
    (day) =>
      `${day.date.toISOString().slice(5, 10)}${day.isLit ? "*" : ""}${day.isToday ? "!" : ""}`
  );

describe("buildStreakDays", () => {
  it("starts at today with no streak", () => {
    assert.deepEqual(render(0, false), [
      "10-26!",
      "10-27",
      "10-28",
      "10-29",
      "10-30",
      "10-31",
      "11-01",
    ]);
  });

  it("puts a streak that started today first", () => {
    assert.deepEqual(render(1, true), [
      "10-26*!",
      "10-27",
      "10-28",
      "10-29",
      "10-30",
      "10-31",
      "11-01",
    ]);
  });

  it("starts a 3-day streak at its first day", () => {
    assert.deepEqual(render(3, true), [
      "10-24*",
      "10-25*",
      "10-26*!",
      "10-27",
      "10-28",
      "10-29",
      "10-30",
    ]);
  });

  it("keeps today pending after a streak that ended yesterday", () => {
    assert.deepEqual(render(3, false), [
      "10-23*",
      "10-24*",
      "10-25*",
      "10-26!",
      "10-27",
      "10-28",
      "10-29",
    ]);
  });

  it("starts a 5-day streak at its first day", () => {
    assert.deepEqual(render(5, true), [
      "10-22*",
      "10-23*",
      "10-24*",
      "10-25*",
      "10-26*!",
      "10-27",
      "10-28",
    ]);
  });

  it("shows the last 7 days once the streak reaches 7", () => {
    assert.deepEqual(render(21, true), [
      "10-20*",
      "10-21*",
      "10-22*",
      "10-23*",
      "10-24*",
      "10-25*",
      "10-26*!",
    ]);
  });

  it("ends a long streak with today pending when it isn't played yet", () => {
    assert.deepEqual(render(10, false), [
      "10-20*",
      "10-21*",
      "10-22*",
      "10-23*",
      "10-24*",
      "10-25*",
      "10-26!",
    ]);
  });

  it("follows the UTC day, not the local one", () => {
    // 23:30 on Oct 26 in Brazil (UTC-3) is already Oct 27 in UTC.
    const lateNight = Date.UTC(2026, 9, 27, 2, 30);
    assert.deepEqual(render(1, true, lateNight)[0], "10-27*!");
  });
});
