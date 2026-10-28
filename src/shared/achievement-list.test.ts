import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterAndSortAchievements,
  formatAchievementUnlockPercentage,
  getAchievementComparisonCounts,
  getAchievementSetKey,
  getComparedOwnerUnlockedNames,
  getComparedTargetAchievements,
  groupAchievementsBySet,
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

  it("ranks by percentage for the whole list when only some achievements have one", () => {
    const list = [
      achievement("A", { points: 100, globalUnlockPercentage: 90 }),
      achievement("B", { points: 10, globalUnlockPercentage: 10 }),
      achievement("C", { points: 50 }),
    ];
    const expected = ["A", "B", "C"];

    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
      [2, 0, 1],
    ]) {
      const shuffled = order.map((index) => list[index]);
      assert.deepEqual(
        names(filterAndSortAchievements(shuffled, defaults)),
        expected
      );
    }

    assert.deepEqual(
      names(
        filterAndSortAchievements(list, { ...defaults, sort: "most_rare" })
      ),
      ["B", "A", "C"]
    );
  });

  it("breaks ties between unrated achievements by points", () => {
    const list = [
      achievement("Rated", { points: 10, globalUnlockPercentage: 50 }),
      achievement("Pricey", { points: 900, unlocked: true }),
      achievement("Cheap", { points: 10, unlocked: true }),
    ];

    assert.deepEqual(
      names(
        filterAndSortAchievements(list, { ...defaults, status: "unlocked" })
      ),
      ["Cheap", "Pricey"]
    );
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

describe("compared achievements for a single user view", () => {
  const compared = {
    achievements: [
      {
        hidden: false,
        icon: "a.png",
        displayName: "First",
        description: "first",
        points: 10,
        globalUnlockPercentage: 50,
        set: { id: 2, name: "Single Player", order: 0 },
        ownerStat: { unlocked: true, unlockTime: 100 },
        targetStat: {
          unlocked: true,
          unlockTime: 200,
          hardcoreUnlockTime: 210,
        },
      },
      {
        hidden: true,
        icon: "b.png",
        displayName: "Secret",
        description: "secret",
        targetStat: { unlocked: false, unlockTime: 0 },
      },
      {
        hidden: true,
        icon: "c.png",
        displayName: "Spoiler",
        description: "spoiler",
        ownerStat: { unlocked: false, unlockTime: 0 },
        targetStat: { unlocked: true, unlockTime: 300 },
      },
    ],
  };

  it("uses the other user's unlocks", () => {
    const list = getComparedTargetAchievements(compared);

    assert.deepEqual(
      list.map(({ name, unlocked, unlockTime, hardcoreUnlockTime }) => ({
        name,
        unlocked,
        unlockTime,
        hardcoreUnlockTime,
      })),
      [
        { name: "0", unlocked: true, unlockTime: 200, hardcoreUnlockTime: 210 },
        {
          name: "1",
          unlocked: false,
          unlockTime: null,
          hardcoreUnlockTime: null,
        },
        {
          name: "2",
          unlocked: true,
          unlockTime: 300,
          hardcoreUnlockTime: null,
        },
      ]
    );
    assert.equal(list[0].points, 10);
    assert.equal(list[0].globalUnlockPercentage, 50);
    assert.deepEqual(list[0].set, {
      id: 2,
      name: "Single Player",
      order: 0,
    });
    assert.equal(list[1].set, null);
    assert.equal(list[2].description, "spoiler");
  });

  it("lists the achievements the viewer has unlocked", () => {
    assert.deepEqual([...getComparedOwnerUnlockedNames(compared)], ["0"]);
  });
});

describe("achievement sets", () => {
  const singlePlayer = { id: 2, name: "Single Player", order: 0 };
  const cooperative = { id: 1, name: "Cooperative", order: 1 };
  const base = { id: 0, name: null, order: 0 };

  it("returns null when a game has fewer than two sets", () => {
    assert.equal(groupAchievementsBySet([{ set: null }, {}]), null);
    assert.equal(
      groupAchievementsBySet([{ set: singlePlayer }, { set: singlePlayer }]),
      null
    );
  });

  it("groups achievements by set in set order, keeping their order inside", () => {
    const groups = groupAchievementsBySet([
      { name: "c1", set: cooperative },
      { name: "s1", set: singlePlayer },
      { name: "c2", set: cooperative },
      { name: "s2", set: singlePlayer },
    ]);

    assert.deepEqual(
      groups?.map(({ key, set, achievements }) => ({
        key,
        name: set?.name,
        names: achievements.map(({ name }) => name),
      })),
      [
        { key: "2", name: "Single Player", names: ["s1", "s2"] },
        { key: "1", name: "Cooperative", names: ["c1", "c2"] },
      ]
    );
  });

  it("keeps the unnamed base set and puts achievements without a set last", () => {
    const groups = groupAchievementsBySet([
      { name: "loose", set: null },
      { name: "co-op", set: cooperative },
      { name: "base", set: base },
    ]);

    assert.deepEqual(
      groups?.map(({ key }) => key),
      ["0", "1", "none"]
    );
    assert.equal(groups?.[0].set?.name, null);
  });

  it("builds a stable key per set", () => {
    assert.equal(getAchievementSetKey({ set: cooperative }), "1");
    assert.equal(getAchievementSetKey({ set: null }), "none");
    assert.equal(getAchievementSetKey({}), "none");
  });
});
