/**
 * Dicionário de siglas de jogos populares.
 * Cada entrada mapeia uma sigla (minúscula) para o título expandido.
 */
const GAME_ACRONYMS: Readonly<Record<string, string>> = {
  // Shooters / FPS
  cod: "call of duty",
  mw: "modern warfare",
  bo: "black ops",
  csgo: "counter-strike global offensive",
  cs2: "counter-strike 2",
  cs: "counter-strike",
  bf: "battlefield",
  r6: "rainbow six siege",
  r6s: "rainbow six siege",
  pubg: "playerunknown battlegrounds",
  gta: "grand theft auto",
  rdr: "red dead redemption",
  rdr2: "red dead redemption 2",
  tf2: "team fortress 2",
  l4d: "left 4 dead",
  l4d2: "left 4 dead 2",
  kf2: "killing floor 2",
  dst: "dont starve together",

  // Racing
  nfs: "need for speed",
  gt: "gran turismo",
  f1: "formula 1",
  fh: "forza horizon",
  fm: "forza motorsport",
  wreck: "wreckfest",

  // RPG / Adventure
  gow: "god of war",
  tlou: "the last of us",
  resi: "resident evil",
  re: "resident evil",
  ff: "final fantasy",
  ffxiv: "final fantasy xiv",
  dmc: "devil may cry",
  ds: "dark souls",
  er: "elden ring",
  bb: "bloodborne",
  sekiro: "sekiro shadows die twice",
  mhw: "monster hunter world",
  mhr: "monster hunter rise",
  botw: "breath of the wild",
  totk: "tears of the kingdom",
  ac: "assassins creed",
  acod: "assassins creed odyssey",
  acv: "assassins creed valhalla",
  acr: "assassins creed revelations",
  ac3: "assassins creed 3",
  cp2077: "cyberpunk 2077",
  cp: "cyberpunk",
  tw3: "the witcher 3",
  tow: "the outer worlds",
  dos2: "divinity original sin 2",
  bg3: "baldurs gate 3",
  bg: "baldurs gate",
  poe: "path of exile",

  // MOBA / Strategy
  lol: "league of legends",
  dota: "dota 2",
  hots: "heroes of the storm",
  sc2: "starcraft 2",
  sc: "starcraft",
  aoe: "age of empires",
  aoe2: "age of empires 2",
  aoe4: "age of empires 4",
  civ: "civilization",
  civ6: "civilization 6",
  civ5: "civilization 5",
  xcom: "xcom 2",
  mhrise: "monster hunter rise",

  // Sports
  fifa: "fifa",
  fc: "ea sports fc",
  nba: "nba 2k",
  nhl: "nhl",
  mlb: "mlb the show",
  nfl: "madden nfl",
  pes: "pro evolution soccer",
  eafc: "ea sports fc",
  mk: "mortal kombat",
  mk11: "mortal kombat 11",
  mk1: "mortal kombat 1",
  sf: "street fighter",
  sf6: "street fighter 6",
  sfv: "street fighter v",
  t8: "tekken 8",
  t7: "tekken 7",

  // Survival / Sandbox
  mc: "minecraft",
  raft: "raft",
  valheim: "valheim",
  ark: "ark survival",
  rust: "rust",
  subnautica: "subnautica",
  nms: "no mans sky",
  tf: "terraria",

  // Horror
  fnaf: "five nights at freddys",
  amogus: "among us",
  au: "among us",
  phas: "phasmophobia",

  // Platformers / Action
  sm: "super mario",
  spiderman: "spider man",
  sm2: "spider man 2",
  ra: "ratchet and clank",
  hk: "hollow knight",
  ori: "ori",
  celeste: "celeste",

  // Others
  gtfo: "gtfo",
  ow: "overwatch",
  ow2: "overwatch 2",
  hs: "hearthstone",
  wot: "world of tanks",
  wow: "world of warcraft",
  fo: "fallout",
  fo4: "fallout 4",
  fo76: "fallout 76",
  obs: "oblivion",
  tes: "elder scrolls",
  skr: "skyrim",
  tes5: "skyrim",
  me: "mass effect",
  mele: "mass effect legendary edition",
  da: "dragon age",
  dai: "dragon age inquisition",
  sims: "the sims",
  msfs: "microsoft flight simulator",
  fs: "flight simulator",
  dbd: "dead by daylight",
  fc24: "ea sports fc 24",
  fc25: "ea sports fc 25",
  wh3: "warhammer 3",
  wh: "warhammer",
  swbf: "star wars battlefront",
  sw: "star wars",
  jfo: "jedi fallen order",
  js: "jedi survivor",
  se: "stellar blade",
};

/**
 * Gera o acrônimo automático de um título extraindo as primeiras letras
 * das palavras principais (ignora artigos/preposições curtas).
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "and",
  "or",
  "by",
  "de",
  "do",
  "da",
  "e",
]);

export function generateAcronym(title: string): string {
  return title
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => !STOP_WORDS.has(word) && /[a-z]/i.test(word))
    .map((word) => word[0])
    .join("");
}

/**
 * Retorna o título expandido se a query for uma sigla conhecida,
 * ou null se não houver match.
 *
 * Também tenta gerar siglas dinamicamente para jogos da biblioteca.
 */
export function expandAcronym(query: string): string | null {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 6) return null;

  return GAME_ACRONYMS[normalized] ?? null;
}

/**
 * Verifica se uma query corresponde ao acrônimo automático de um título.
 * Ex: query="nfs", title="Need for Speed" → true
 */
export function matchesAcronym(query: string, title: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || q.length > 6) return false;

  // Check static dictionary
  const expanded = GAME_ACRONYMS[q];
  if (expanded && title.toLowerCase().includes(expanded)) return true;

  // Check dynamic acronym generation
  const titleAcronym = generateAcronym(title);
  return titleAcronym === q;
}
