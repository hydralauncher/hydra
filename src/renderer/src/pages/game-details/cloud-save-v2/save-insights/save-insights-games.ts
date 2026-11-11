import type {
  GameShop,
  SaveStatKind,
  SaveStatValue,
  SaveSummarySlot,
} from "@types";

export interface SaveScene {
  id: string;
  overlay: string | null;
}

export type SaveSlotTiles = "level" | "number";

export interface SaveInsightsGame {
  /** Each slot is a character or a save file the player picks, shown as tiles. */
  tiles?: SaveSlotTiles;
  /** Lowercase unit after a value in the stat row. */
  units?: Partial<Record<SaveStatKind, string>>;
  scene?: (slot: SaveSummarySlot) => SaveScene;
}

const statValue = (slot: SaveSummarySlot, kind: SaveStatKind) =>
  slot.stats.find((stat) => stat.kind === kind)?.value;

export const statText = (value: SaveStatValue | undefined) => {
  if (!value) return null;
  if (value.type === "label") return value.value.text;
  if (value.type === "text") return value.value;
  return null;
};

const statNumber = (value: SaveStatValue | undefined) => {
  if (!value) return null;
  if (
    value.type === "integer" ||
    value.type === "seconds" ||
    value.type === "percent"
  ) {
    return value.value;
  }
  return null;
};

const scene = (id: string, overlay: string | null = null): SaveScene => ({
  id,
  overlay,
});

const byText = (
  kind: SaveStatKind,
  table: Record<string, SaveScene>,
  fallback: SaveScene,
  normalize: (text: string) => string = (text) => text
) => {
  return (slot: SaveSummarySlot) => {
    const text = statText(statValue(slot, kind));
    return (text && table[normalize(text)]) || fallback;
  };
};

const cyberpunk = byText(
  "characterClass",
  {
    Nomad: scene("cyberpunk-nomad", "dust"),
    "Street Kid": scene("cyberpunk-street-kid", "rain"),
    Corpo: scene("cyberpunk-corpo"),
  },
  scene("cyberpunk-street-kid", "rain")
);

const tlouSummer = scene("tlou-summer", "fireflies");
const tlouFall = scene("tlou-fall", "dust");
const tlouSpring = scene("tlou-spring");
const theLastOfUs = byText(
  "chapter",
  {
    "The Quarantine Zone": tlouSummer,
    Hometown: tlouSummer,
    "The Outskirts": tlouSummer,
    "Bill's Town": tlouSummer,
    Pittsburgh: tlouSummer,
    "The Suburbs": tlouSummer,
    "Tommy's Dam": tlouFall,
    "The University": tlouFall,
    "Lakeside Resort": scene("tlou-winter", "snow"),
    "Bus Depot": tlouSpring,
    "The Firefly Lab": tlouSpring,
    Jackson: tlouSpring,
  },
  tlouSummer
);

const redDeadRedemption = (slot: SaveSummarySlot) => {
  const completion = statNumber(statValue(slot, "completion"));
  if (completion === null) return scene("rdr2-camp", "embers");
  if (completion < 10) return scene("rdr2-colter", "snow");
  if (completion > 90) return scene("rdr2-ranch", "dust");
  return scene("rdr2-camp", "embers");
};

const HOUR_SECONDS = 3600;

// The save has no act or region, so playtime stands in for how far the story is.
const ghostOfTsushima = (slot: SaveSummarySlot) => {
  const location = statText(statValue(slot, "location"));
  if (location === "Iki Island") return scene("got-iki");
  if (location !== "Tsushima") return scene("got-fallback");
  const playtime = statNumber(statValue(slot, "playtime")) ?? 0;
  if (playtime < HOUR_SECONDS) return scene("got-komoda", "embers");
  if (playtime < 20 * HOUR_SECONDS) return scene("got-izuhara");
  if (playtime < 40 * HOUR_SECONDS) return scene("got-toyotama");
  return scene("got-kamiagata");
};

const RE4_AREAS: Record<string, SaveScene> = {
  ...Object.fromEntries(
    ["Path to the Village", "Valley", "Cemetery"].map((area) => [
      area,
      scene("re4-path", "re4-fog-path"),
    ])
  ),
  ...Object.fromEntries(
    ["The Village", "The Farm", "Chief's House"].map((area) => [
      area,
      scene("re4-village", "embers"),
    ])
  ),
  ...Object.fromEntries(
    ["The Lake", "Swamp", "Waterfall", "Mercenaries: Waterworld"].map(
      (area) => [area, scene("re4-lake", "re4-fog-lake")]
    )
  ),
  "El Gigante (Right Path)": scene("re4-el-gigante"),
  ...Object.fromEntries(
    ["Church", "Cemetery (Night)", "Cabin"].map((area) => [
      area,
      scene("re4-church"),
    ])
  ),
  ...Object.fromEntries(
    [
      "Castle Gallery",
      "Castle Dining Hall",
      "Castle Water Room",
      "Giant Knight Hall",
    ].map((area) => [area, scene("re4-castle-halls")])
  ),
  ...Object.fromEntries(
    ["U-3 Fight Area", "Island Before U-3", "Island After U-3"].map((area) => [
      area,
      scene("re4-u3"),
    ])
  ),
  ...Object.fromEntries(
    ["Furnace Dual El Gigante", "Lava Trolley"].map((area) => [
      area,
      scene("re4-furnace", "embers"),
    ])
  ),
  "Mercenaries: Village": scene("re4-village", "embers"),
  "Mercenaries: Castle": scene("re4-castle"),
  "Mercenaries: Island": scene("re4-island", "re4-fog-island"),
};

const residentEvil4 = (slot: SaveSummarySlot) => {
  if (statText(statValue(slot, "characterName")) === "Ashley") {
    return scene("re4-ashley");
  }
  const area = statText(statValue(slot, "location"));
  if (area && RE4_AREAS[area]) return RE4_AREAS[area];
  if (area?.endsWith("(Night)"))
    return scene("re4-village-night", "re4-rain-night");
  const chapter = statText(statValue(slot, "chapter"));
  if (chapter === "Chapter 1-1") return scene("re4-path", "re4-fog-path");
  if (chapter === "Chapter 1-2") return scene("re4-village", "embers");
  if (chapter === "Chapter 1-3") return scene("re4-lake", "re4-fog-lake");
  if (chapter?.startsWith("Chapter 2")) {
    return scene("re4-village-night", "re4-rain-night");
  }
  if (chapter?.startsWith("Chapter 3")) return scene("re4-castle");
  if (chapter?.startsWith("Chapter 4")) return scene("re4-castle-depths");
  if (chapter?.startsWith("Chapter 5") || chapter === "Final Chapter") {
    return scene("re4-island", "re4-fog-island");
  }
  return scene("re4-fallback");
};

const celeste = byText(
  "chapter",
  {
    Prologue: scene("celeste-prologue", "snow"),
    Epilogue: scene("celeste-prologue", "snow"),
    "Forsaken City": scene("celeste-forsaken-city", "snow"),
    "Old Site": scene("celeste-old-site"),
    "Celestial Resort": scene("celeste-celestial-resort", "celeste-dust-mauve"),
    "Golden Ridge": scene("celeste-golden-ridge", "celeste-dust-pink"),
    "Mirror Temple": scene("celeste-mirror-temple", "celeste-fog-red"),
    Reflection: scene("celeste-reflection", "celeste-fog-cyan"),
    "The Summit": scene("celeste-summit"),
    Core: scene("celeste-core", "embers"),
    Farewell: scene("celeste-farewell"),
  },
  scene("celeste-prologue", "snow"),
  (text) => text.replace(/ [BC]-Side$/, "")
);

const bombRushCyberfunk = byText(
  "location",
  {
    Prelude: scene("brc-prelude"),
    Hideout: scene("brc-hideout"),
    "Versum Hill": scene("brc-versum-hill"),
    "Millennium Square": scene("brc-millennium-square"),
    "Brink Terminal": scene("brc-brink-terminal", "brc-dust-teal"),
    "Millennium Mall": scene("brc-millennium-mall"),
    "Pyramid Island": scene("brc-pyramid-island"),
    Mataan: scene("brc-mataan"),
  },
  scene("brc-fallback")
);

const ds3Bonfire = scene("ds3-bonfire", "embers");
const ds3HighWall = scene("ds3-high-wall", "embers");
const ds3Farron = scene("ds3-farron", "ds3-fog");
const ds3Catacombs = scene("ds3-catacombs");
const ds3Irithyll = scene("ds3-irithyll", "snow");
const ds3Dungeon = scene("ds3-dungeon");
const ds3Lothric = scene("ds3-lothric");
const darkSouls3 = byText(
  "location",
  {
    "Firelink Shrine": ds3Bonfire,
    "Cemetery of Ash": ds3Bonfire,
    "Untended Graves": ds3Bonfire,
    "High Wall of Lothric": ds3HighWall,
    "Archdragon Peak": ds3HighWall,
    "Undead Settlement": scene("ds3-settlement"),
    "Road of Sacrifices": ds3Farron,
    "Farron Keep": ds3Farron,
    "Cathedral of the Deep": scene("ds3-cathedral"),
    "Catacombs of Carthus": ds3Catacombs,
    "Smouldering Lake": ds3Catacombs,
    "Irithyll of the Boreal Valley": ds3Irithyll,
    "Anor Londo": ds3Irithyll,
    "Irithyll Dungeon": ds3Dungeon,
    "Profaned Capital": ds3Dungeon,
    "Lothric Castle": ds3Lothric,
    "Consumed King's Garden": ds3Lothric,
    "Grand Archives": ds3Lothric,
    "Kiln of the First Flame": scene("ds3-kiln", "embers"),
    "Painted World of Ariandel": scene("ds3-ariandel", "snow"),
    "The Dreg Heap": scene("ds3-dreg", "ds3-dust"),
    "The Ringed City": scene("ds3-ringed"),
  },
  ds3Bonfire,
  (text) => text.split(" / ")[0]
);

const eldenRing = (slot: SaveSummarySlot) => {
  const location = statText(statValue(slot, "location")) ?? "";
  if (/Stormveil/.test(location)) return scene("elden-ring-stormveil");
  if (/Liurnia|Raya Lucaria|Caria|Academy/.test(location)) {
    return scene("elden-ring-liurnia");
  }
  return scene("elden-ring-limgrave");
};

const spiderMan2 = (slot: SaveSummarySlot) =>
  statText(statValue(slot, "characterName")) === "Peter Parker"
    ? scene("spider-man-2-peter")
    : scene("spider-man-2-miles");

const STEAM_GAMES: Record<string, SaveInsightsGame> = {
  "1091500": {
    scene: cyberpunk,
    units: { money: "eddies", reputation: "street_cred" },
  },
  "1888930": { scene: theLastOfUs },
  "1174180": { scene: redDeadRedemption },
  "2215430": {
    scene: ghostOfTsushima,
    units: { money: "supplies" },
  },
  "254700": {
    scene: residentEvil4,
    units: { money: "pesetas" },
  },
  "504230": {
    scene: celeste,
    tiles: "number",
    units: { collectibles: "strawberries", hearts: "crystal_hearts" },
  },
  "1353230": { scene: bombRushCyberfunk, tiles: "number" },
  "374320": {
    scene: darkSouls3,
    tiles: "level",
    units: { money: "souls" },
  },
  "1245620": {
    scene: eldenRing,
    tiles: "level",
    units: { money: "runes", collectibles: "great_runes" },
  },
  "2651280": { scene: spiderMan2 },
  "3768760": { scene: () => scene("first-light") },
  "1817070": { scene: () => scene("spider-man-remastered") },
  "3751260": { scene: () => scene("dawnwalker") },
  "3751950": { scene: () => scene("ac-black-flag") },
};

export const getSaveInsightsGame = (
  shop: GameShop,
  objectId: string
): SaveInsightsGame => (shop === "steam" ? STEAM_GAMES[objectId] : null) ?? {};
