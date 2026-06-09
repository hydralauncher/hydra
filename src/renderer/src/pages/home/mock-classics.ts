/* Mock PS2 / PS3 classics datasets.
 *
 * Why: in the staging environment the catalogue API does not return
 * PS2 / PS3 results — the launchbox classics endpoint is heavily
 * PS1-biased and the per-platform filtered queries come back empty.
 * Without this stub the home page can never demonstrate what a PS2 or
 * PS3 row would look like, which blocks reviewing the row designs and
 * any per-platform/genre row variants we might want to build.
 *
 * What: real game titles (the most recognisable PS2 / PS3 catalogue,
 * so reviewers can read the rows at a glance) paired with portrait
 * SVG placeholder cover art. The placeholder generator produces a
 * dark, branded card with the platform mark + title so the cards
 * read as "PS2 / PS3 box-art slot" even though no real artwork is
 * available.
 *
 * Each entry is a HomeRowGame (the same type the catalogue feed
 * returns) so it can be dropped straight into the existing ps2Games
 * / ps3Games state with no special-casing downstream — sliceDiscovery,
 * enrichSources, ShopLogo, vertical / horizontal cards all keep
 * working. */

import type { HomeRowGame } from "./home-game-card";

type System = "ps2" | "ps3";

/* Portrait box-art placeholder — sized at PS-box aspect (≈5/6.5) so
   it fills the vertical-card slot without letterboxing. Encoded as a
   data: URI so it works offline and doesn't require a CDN hop. */
function classicsBoxArt(title: string, system: System): string {
  const isPs2 = system === "ps2";
  const bg = isPs2 ? "#0c2742" : "#0a0a0a";
  const accent = isPs2 ? "#f5b400" : "#e0e0e0";
  const accentSoft = isPs2 ? "rgba(245,180,0,0.18)" : "rgba(224,224,224,0.12)";
  const platformLabel = isPs2 ? "PlayStation 2" : "PlayStation 3";
  const ps = isPs2 ? "PS2" : "PS3";

  /* Wrap long titles by splitting on whitespace into up to 4 lines.
     Falls back to truncation if any single token is too long. */
  const wrap = (s: string, maxPerLine = 14): string[] => {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur.length) {
        cur = w;
        continue;
      }
      if ((cur + " " + w).length <= maxPerLine) cur = cur + " " + w;
      else {
        lines.push(cur);
        cur = w;
      }
      if (lines.length === 3) break;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  };
  const lines = wrap(title);
  const startY = 165 - (lines.length - 1) * 16;

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${bg}" stop-opacity="1"/>
        <stop offset="100%" stop-color="#000" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect width="200" height="260" fill="url(#g)"/>
    <rect x="0" y="0" width="200" height="22" fill="${accent}"/>
    <text x="100" y="15" text-anchor="middle" fill="${bg}" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="800" letter-spacing="2">${platformLabel.toUpperCase()}</text>
    <rect x="14" y="60" width="172" height="120" fill="${accentSoft}" rx="4"/>
    <text x="100" y="100" text-anchor="middle" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="900" opacity="0.18">${ps}</text>
    ${lines
      .map(
        (l, i) =>
          `<text x="100" y="${startY + i * 16}" text-anchor="middle" fill="#fafafa" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700">${escape(l)}</text>`
      )
      .join("\n    ")}
    <rect x="0" y="252" width="200" height="8" fill="${accent}" opacity="0.4"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* Landscape banner used for libraryImageUrl — only needed by the
   classics PC-hero layout fallback. Kept extremely simple. */
function classicsBanner(title: string, system: System): string {
  const isPs2 = system === "ps2";
  const bg = isPs2 ? "#0c2742" : "#0a0a0a";
  const accent = isPs2 ? "#f5b400" : "#e0e0e0";
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 215">
    <rect width="460" height="215" fill="${bg}"/>
    <rect x="0" y="0" width="460" height="3" fill="${accent}"/>
    <text x="230" y="115" text-anchor="middle" fill="#fafafa" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${escape(title)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface MockGame {
  title: string;
  system: System;
  genres: string[];
}

const MOCKS: MockGame[] = [
  /* PS2 — recognisable, well-distributed across genres so the row
     filters (Action / Horror / RPG / Adventure / Racing) all have
     candidates and the rows visibly differ from one another. */
  {
    title: "Shadow of the Colossus",
    system: "ps2",
    genres: ["Action", "Adventure"],
  },
  { title: "God of War II", system: "ps2", genres: ["Action", "Adventure"] },
  { title: "Final Fantasy XII", system: "ps2", genres: ["RPG", "Adventure"] },
  { title: "Persona 4", system: "ps2", genres: ["RPG"] },
  {
    title: "Metal Gear Solid 3: Snake Eater",
    system: "ps2",
    genres: ["Action", "Adventure", "Stealth"],
  },
  {
    title: "Devil May Cry 3: Dante's Awakening",
    system: "ps2",
    genres: ["Action"],
  },
  { title: "Silent Hill 2", system: "ps2", genres: ["Horror", "Adventure"] },
  { title: "Resident Evil 4", system: "ps2", genres: ["Horror", "Action"] },
  {
    title: "Grand Theft Auto: San Andreas",
    system: "ps2",
    genres: ["Action", "Open World"],
  },
  { title: "Gran Turismo 4", system: "ps2", genres: ["Racing", "Simulation"] },
  { title: "Kingdom Hearts II", system: "ps2", genres: ["RPG", "Action"] },
  { title: "Okami", system: "ps2", genres: ["Action", "Adventure"] },
  {
    title: "Ratchet & Clank: Up Your Arsenal",
    system: "ps2",
    genres: ["Action", "Platformer"],
  },
  { title: "Burnout 3: Takedown", system: "ps2", genres: ["Racing"] },
  {
    title: "Fatal Frame II: Crimson Butterfly",
    system: "ps2",
    genres: ["Horror"],
  },
  { title: "Ico", system: "ps2", genres: ["Adventure", "Puzzle"] },

  /* PS3 — first major HD generation, so most slots are 7th-gen
     blockbusters. Genres again spread out so themed PS3 rows can
     populate distinctly from PS2 / PS1. */
  {
    title: "The Last of Us",
    system: "ps3",
    genres: ["Action", "Adventure", "Horror"],
  },
  {
    title: "Uncharted 2: Among Thieves",
    system: "ps3",
    genres: ["Action", "Adventure"],
  },
  { title: "Demon's Souls", system: "ps3", genres: ["RPG", "Souls-like"] },
  { title: "Journey", system: "ps3", genres: ["Adventure", "Indie"] },
  { title: "Heavy Rain", system: "ps3", genres: ["Adventure"] },
  {
    title: "Red Dead Redemption",
    system: "ps3",
    genres: ["Action", "Open World"],
  },
  { title: "LittleBigPlanet", system: "ps3", genres: ["Platformer"] },
  { title: "Infamous 2", system: "ps3", genres: ["Action", "Open World"] },
  { title: "Killzone 2", system: "ps3", genres: ["Action"] },
  { title: "MotorStorm: Apocalypse", system: "ps3", genres: ["Racing"] },
  { title: "God of War III", system: "ps3", genres: ["Action", "Adventure"] },
  {
    title: "Metal Gear Solid 4: Guns of the Patriots",
    system: "ps3",
    genres: ["Action", "Stealth"],
  },
  { title: "Yakuza 4", system: "ps3", genres: ["Action", "RPG"] },
  { title: "Resistance 3", system: "ps3", genres: ["Action"] },
  { title: "Dark Souls", system: "ps3", genres: ["RPG", "Souls-like"] },
  {
    title: "Bioshock Infinite",
    system: "ps3",
    genres: ["Action", "Adventure"],
  },
];

const PLATFORM_STRING: Record<System, string> = {
  ps2: "Sony Playstation 2",
  ps3: "Sony Playstation 3",
};

/* Stable slug for objectId. The catalogue uses opaque IDs but
   downstream code just needs uniqueness + matching shop, so a slug
   derived from title is sufficient for the prototype. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const toRowGame = (m: MockGame): HomeRowGame => ({
  objectId: `mock-${m.system}-${slug(m.title)}`,
  shop: "launchbox",
  title: m.title,
  platform: PLATFORM_STRING[m.system],
  genres: m.genres,
  coverImageUrl: classicsBoxArt(m.title, m.system),
  libraryImageUrl: classicsBanner(m.title, m.system),
  downloadSources: [],
});

export const MOCK_PS2_GAMES: HomeRowGame[] = MOCKS.filter(
  (m) => m.system === "ps2"
).map(toRowGame);

export const MOCK_PS3_GAMES: HomeRowGame[] = MOCKS.filter(
  (m) => m.system === "ps3"
).map(toRowGame);
