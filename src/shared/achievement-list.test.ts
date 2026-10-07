import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterAndSortAchievements,
  formatAchievementUnlockPercentage,
  getAchievementComparisonCounts,
  matchesAchievementComparisonFilter,
  getAchievementStatusCounts,
  isAchievementConcealed,
} from "./achievement-list.js";

const achievement = (
  name: string,
  overrides: Partial<{
    displayName: string;
    description: string;
    hidden: boolean;
    unlocked: boolean;
    points: number;
    globalUnlockPercentage: number;
  }> = {}
) => ({
  name,
  displayName: name,
  description: `${name} description`,
  hidden: false,
  unlocked: false,
  ...overrides,
});

const achievements = [
  achievement("Common", { points: 10, unlocked: true }),
  achievement("Rare", { points: 2000 }),
  achievement("Uncommon", { points: 500, unlocked: true }),
  achievement("Secret", { points: 1500, hidden: true }),
  achievement("Unknown"),
];

const names = (list: { name: string }[]) => list.map(({ name }) => name);

const defaults = {
  search: "",
  status: "all" as const,
  sort: "most_common" as const,
  isConcealed: (item: { hidden: boolean; unlocked: boolean }) =>
    isAchievementConcealed(item, false),
};

describe("filterAndSortAchievements", () => {
  it("sorts from most common to most rare with unknown rarity last", () => {
    assert.deepEqual(names(filterAndSortAchievements(achievements, defaults)), [
      "Common",
      "Uncommon",
      "Secret",
      "Rare",
      "Unknown",
    ]);
  });

  it("sorts from most rare to most common", () => {
    assert.deepEqual(
      names(
        filterAndSortAchievements(achievements, {
          ...defaults,
          sort: "most_rare",
        })
      ),
      ["Rare", "Secret", "Uncommon", "Common", "Unknown"]
    );
  });

  it("filters by unlock status", () => {
    assert.deepEqual(
      names(
        filterAndSortAchievements(achievements, {
          ...defaults,
          status: "unlocked",
        })
      ),
      ["Common", "Uncommon"]
    );
    assert.deepEqual(
      names(
        filterAndSortAchievements(achievements, {
          ...defaults,
          status: "locked",
        })
      ),
      ["Secret", "Rare", "Unknown"]
    );
  });

  it("searches titles and descriptions ignoring case and accents", () => {
    const list = [
      achievement("A", { displayName: "Café Run" }),
      achievement("B", { description: "Defeat the BOSS" }),
      achievement("C"),
    ];

    assert.deepEqual(
      names(filterAndSortAchievements(list, { ...defaults, search: "cafe" })),
      ["A"]
    );
    assert.deepEqual(
      names(filterAndSortAchievements(list, { ...defaults, search: "boss" })),
      ["B"]
    );
  });

  it("does not match concealed achievements by search", () => {
    assert.deepEqual(
      names(
        filterAndSortAchievements(achievements, {
          ...defaults,
          search: "secret",
        })
      ),
      []
    );
    assert.deepEqual(
      names(
        filterAndSortAchievements(achievements, {
          ...defaults,
          search: "secret",
          isConcealed: () => false,
        })
      ),
      ["Secret"]
    );
  });

  it("prefers unlock percentage over points when both have it", () => {
    const list = [
      achievement("A", { points: 2000, globalUnlockPercentage: 60 }),
      achievement("B", { points: 10, globalUnlockPercentage: 5 }),
      achievement("C", { points: 500, globalUnlockPercentage: 30 }),
    ];

    assert.deepEqual(names(filterAndSortAchievements(list, defaults)), [
      "A",
      "C",
      "B",
    ]);
  });

  it("does not mutate the input list", () => {
    const list = [...achievements];
    filterAndSortAchievements(list, { ...defaults, sort: "most_rare" });
    assert.deepEqual(names(list), names(achievements));
  });
});

describe("isAchievementConcealed", () => {
  it("conceals only locked hidden achievements when the preference is off", () => {
    assert.equal(
      isAchievementConcealed({ hidden: true, unlocked: false }, false),
      true
    );
    assert.equal(
      isAchievementConcealed({ hidden: true, unlocked: true }, false),
      false
    );
    assert.equal(
      isAchievementConcealed({ hidden: true, unlocked: false }, true),
      false
    );
    assert.equal(
      isAchievementConcealed({ hidden: false, unlocked: false }, false),
      false
    );
  });
});

describe("getAchievementStatusCounts", () => {
  it("counts all, unlocked and locked achievements", () => {
    assert.deepEqual(getAchievementStatusCounts(achievements), {
      all: 5,
      unlocked: 2,
      locked: 3,
    });
  });
});

describe("formatAchievementUnlockPercentage", () => {
  it("formats with at most one decimal", () => {
    assert.equal(formatAchievementUnlockPercentage(12.345, "en"), "12.3%");
    assert.equal(formatAchievementUnlockPercentage(50, "en"), "50%");
  });

  it("collapses tiny percentages", () => {
    assert.equal(formatAchievementUnlockPercentage(0.04, "en"), "<0.1%");
  });
});

describe("achievement comparison", () => {
  const pairs = [
    { ownerUnlocked: true, targetUnlocked: true },
    { ownerUnlocked: true, targetUnlocked: false },
    { ownerUnlocked: false, targetUnlocked: true },
    { ownerUnlocked: false, targetUnlocked: true },
    { ownerUnlocked: false, targetUnlocked: false },
  ];

  const matching = (
    filter: Parameters<typeof matchesAchievementComparisonFilter>[1]
  ) => pairs.map((pair) => matchesAchievementComparisonFilter(pair, filter));

  it("filters by both, neither and each person", () => {
    assert.deepEqual(matching("all"), [true, true, true, true, true]);
    assert.deepEqual(matching("both"), [true, false, false, false, false]);
    assert.deepEqual(matching("neither"), [false, false, false, false, true]);
    assert.deepEqual(matching("owner"), [true, true, false, false, false]);
    assert.deepEqual(matching("target"), [true, false, true, true, false]);
  });

  it("counts every comparison filter", () => {
    assert.deepEqual(getAchievementComparisonCounts(pairs), {
      all: 5,
      both: 1,
      neither: 1,
      owner: 2,
      target: 3,
    });
  });
});
